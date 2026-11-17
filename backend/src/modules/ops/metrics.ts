import type { Request, RequestHandler } from "express";
import type { Db } from "../../infrastructure/database/db.js";
import type { Logger } from "../../infrastructure/logger/logger.js";

/** Histogram bucket upper bounds (ms). The last one is the overflow bucket. */
export const OVERFLOW_MS = 2147483647;
export const LATENCY_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, OVERFLOW_MS] as const;

// Top-level path segments we serve. Anything else without a matched route is a scanner/typo and lands in one "unmatched" group.
const TOP = new Set(["admin", "api", "health", "mcp", "oauth", "webhooks", "workspaces", "me", "invitations", "billing", ".well-known", "docs", "openapi.json", "platforms"]);

/**
 * Bounded-cardinality group for a request: the matched Express route pattern cut to its resource
 * ("/workspaces/:workspaceId/posts/:postId/publish" -> "/workspaces/:workspaceId/posts"). Raw paths are never used as groups.
 */
export function routeGroup(pattern: string | undefined, path: string): string {
  if (pattern) {
    const s = pattern.split("/").filter(Boolean);
    return "/" + s.slice(0, s[0] === "workspaces" ? 3 : 2).join("/");
  }
  const first = path.split("?")[0]!.split("/")[1] ?? "";
  return TOP.has(first) ? `/${first}` : "unmatched";
}

/** Quantile estimated from histogram buckets by linear interpolation inside the bucket (Prometheus-style). Overflow reports its lower bound. */
export function quantile(buckets: readonly { le: number; count: number }[], q: number): number | null {
  const total = buckets.reduce((s, b) => s + b.count, 0);
  if (!total) return null;
  const target = q * total;
  let cum = 0;
  for (const b of [...buckets].sort((x, y) => x.le - y.le)) {
    const i = LATENCY_BUCKETS.indexOf(b.le as never);
    const lo = i > 0 ? LATENCY_BUCKETS[i - 1]! : 0;
    if (b.count > 0 && cum + b.count >= target) return b.le === OVERFLOW_MS ? lo : lo + ((b.le - lo) * (target - cum)) / b.count;
    cum += b.count;
  }
  return null;
}

/** Strip anything secret- or person-shaped from an error message before it is stored. */
export function redact(message: string): string {
  return message
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]")
    .replace(/([\w-]*(?:token|key|secret|password|authorization|cookie|code))(\s*[=:]\s*)(?:Bearer\s+)?[^\s&]+/gi, "$1$2[redacted]")   // no \b: it does not fire after "_" (access_token=)
    .replace(/[A-Za-z0-9_-]{24,}/g, (m) => (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(m) ? m : "[redacted]"))   // long opaque strings; ids (UUIDs) stay
    .slice(0, 500);
}

interface Cell { minute: string; group: string; status: number; le: number; count: number; sumMs: number }
interface ErrorRow { source: "http" | "dlq"; route: string; method: string | null; requestId: string | null; message: string }

const FLUSH_SQL = `WITH m AS (
    INSERT INTO request_metrics (minute, route_group, status, le_ms, count, sum_ms)
    SELECT * FROM unnest($1::timestamptz[], $2::text[], $3::int[], $4::int[], $5::int[], $6::bigint[])
    ON CONFLICT (minute, route_group, status, le_ms) DO UPDATE SET count = request_metrics.count + EXCLUDED.count, sum_ms = request_metrics.sum_ms + EXCLUDED.sum_ms
  ), e AS (
    INSERT INTO server_errors (source, route, method, request_id, message) SELECT * FROM unnest($7::text[], $8::text[], $9::text[], $10::text[], $11::text[])
  ) SELECT 1`;

/**
 * Request metrics + error capture, aggregated in isolate memory and written with ONE statement (one connection) per flush,
 * a few seconds after the response via `defer` (waitUntil on Workers). Nothing here touches the request's critical path,
 * and a failed write is logged and dropped: losing a few seconds of metrics on isolate eviction is accepted.
 * Flushes are independent (no promise chain across requests: on Workers a request's I/O must not run in another request's context).
 * Without `defer` nothing is flushed automatically; callers (tests, scripts) call flush().
 */
export function createMetrics(o: { db: Db; log: Logger; defer?: ((p: Promise<unknown>) => void) | undefined; flushDelayMs?: number; maxBuffered?: number }) {
  const delay = o.flushDelayMs ?? 5000, max = o.maxBuffered ?? 500;
  let cells = new Map<string, Cell>(), errors: ErrorRow[] = [], scheduled = false;

  const write = async (c: Cell[], e: ErrorRow[]) => {
    if (!c.length && !e.length) return;
    try {
      await o.db.query(FLUSH_SQL, [c.map((x) => x.minute), c.map((x) => x.group), c.map((x) => x.status), c.map((x) => x.le), c.map((x) => x.count), c.map((x) => x.sumMs),
        e.map((x) => x.source), e.map((x) => x.route), e.map((x) => x.method), e.map((x) => x.requestId), e.map((x) => x.message)]);
    } catch (err) {
      o.log.warn({ err, cells: c.length, errors: e.length }, "ops metrics flush failed");
    }
  };
  /** Writes everything buffered so far in one statement. Never rejects. */
  const flush = (): Promise<void> => {
    const c = [...cells.values()], e = errors;
    cells = new Map(); errors = []; scheduled = false;
    return write(c, e);
  };
  const schedule = () => {
    const defer = o.defer;
    if (!defer) return;
    if (cells.size + errors.length >= max) { defer(flush()); return; }
    if (scheduled) return;
    scheduled = true;
    defer(new Promise<void>((r) => { const h = setTimeout(r, delay) as unknown as { unref?: () => void }; h.unref?.(); }).then(flush));
  };

  const record = (group: string, status: number, ms: number) => {
    const minute = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
    const le = LATENCY_BUCKETS.find((b) => ms <= b)!;
    const k = `${minute}|${group}|${status}|${le}`;
    const c = cells.get(k);
    if (c) { c.count++; c.sumMs += ms; } else cells.set(k, { minute, group, status, le, count: 1, sumMs: ms });
    schedule();
  };

  return {
    flush,
    record,
    /** Express middleware: times every request and records it when the response finishes. */
    middleware: (): RequestHandler => (req, res, next) => {
      const t = Date.now();
      res.on("finish", () => { const p = (req.route as { path?: unknown } | undefined)?.path; record(routeGroup(typeof p === "string" ? p : undefined, req.originalUrl), res.statusCode, Date.now() - t); });
      next();
    },
    /** An unhandled error that became a 500. Only method, path, request id and a redacted message are kept. */
    captureError: (req: Request, err: unknown) => {
      errors.push({ source: "http", route: req.originalUrl.split("?")[0]!.slice(0, 300), method: req.method, requestId: req.id ?? null, message: redact(err instanceof Error ? err.message : String(err)) || "(no message)" });
      schedule();
    },
    /** Queue messages that exhausted their retries (bodies are our own ids, never user content). */
    deadLettered: (queue: string, messages: readonly { body: unknown; attempts: number }[]) => {
      for (const m of messages) errors.push({ source: "dlq", route: queue, method: null, requestId: null, message: redact(`dead-lettered after ${m.attempts} attempts: ${JSON.stringify(m.body) ?? ""}`) });
      if (messages.length) schedule();
    },
  };
}
export type Metrics = ReturnType<typeof createMetrics>;
