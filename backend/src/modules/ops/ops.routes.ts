import { Router } from "express";
import { z } from "zod";
import type { Db } from "../../infrastructure/database/db.js";
import type { Logger } from "../../infrastructure/logger/logger.js";
import { validate } from "../../shared/middleware/validate.js";
import { opsAuth } from "../../shared/middleware/ops-auth.js";
import { workerStatus } from "../../workers/heartbeat.js";
import { quantile } from "./metrics.js";
import { estimateMonthlyCosts, PRICES } from "./costs.js";

const RANGES = { "1h": { interval: "1 hour", bin: "1 minute", binMs: 60_000, ms: 3_600_000 }, "24h": { interval: "24 hours", bin: "15 minutes", binMs: 900_000, ms: 86_400_000 }, "7d": { interval: "7 days", bin: "2 hours", binMs: 7_200_000, ms: 604_800_000 } } as const;
const page = { before: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) };
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const round1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);

/** Summarises histogram rows (one per latency bucket) into count, error counts and estimated percentiles. */
function summarize(rows: readonly { le_ms: number; n: number; e5: number; e4?: number; ms?: number }[]) {
  const count = rows.reduce((s, r) => s + r.n, 0), errors5xx = rows.reduce((s, r) => s + r.e5, 0);
  const b = rows.map((r) => ({ le: r.le_ms, count: r.n }));
  return {
    count, errors5xx, errors4xx: rows.reduce((s, r) => s + (r.e4 ?? 0), 0), errorRate: count ? errors5xx / count : null,
    avgMs: count ? round1(rows.reduce((s, r) => s + (r.ms ?? 0), 0) / count) : null,
    p50: round1(quantile(b, 0.5)), p95: round1(quantile(b, 0.95)), p99: round1(quantile(b, 0.99)),
  };
}

/**
 * Owner-only Health & Activity dashboard data. Read-only, guarded by OPS_READ_TOKEN (or OPS_TOKEN), never in the public OpenAPI.
 * Every number comes from a table we own or from Postgres' catalog; anything we do not record is reported as null / "not tracked".
 */
export function opsRoutes(d: { db: Db; log: Logger; opsToken?: string | undefined; opsReadToken?: string | undefined }) {
  const r = Router();
  r.use("/admin/ops", opsAuth(d.opsReadToken, d.opsToken));
  // Every query holds its own connection and a Worker may have 6 open at once; the overview fans out ~9, so extras queue and hit the timeout.
  let busy = 0;
  const waiting: (() => void)[] = [];
  const gate = async <T>(fn: () => Promise<T>): Promise<T> => {
    while (busy >= 4) await new Promise<void>((go) => waiting.push(go));
    busy++;
    try { return await fn(); } finally { busy--; waiting.shift()?.(); }
  };
  const q = <R>(sql: string, p?: unknown[]) => gate(() => d.db.query<R>(sql, p).then((x) => x.rows));

  r.get("/admin/ops/overview", async (_req, res) => {
    const t0 = Date.now();
    const ping = await d.db.query("SELECT 1").then(() => ({ ok: true, latencyMs: Date.now() - t0 }), () => ({ ok: false, latencyMs: null }));
    // Independent sections: one failing query degrades its panel only.
    const [scalars, workers, tables, accounts, publishing, subs, failures, dlq] = await Promise.allSettled([
      q<Record<string, unknown>>(`SELECT
        pg_database_size(current_database())::float8 AS db_bytes,
        (SELECT setting FROM pg_settings WHERE name = 'neon.max_cluster_size') AS neon_max_mb,
        (SELECT count(*) FROM publishing_jobs WHERE status = 'pending')::int AS pending,
        (SELECT count(*) FROM publishing_jobs WHERE status = 'pending' AND next_attempt_at <= now())::int AS pending_due,
        (SELECT EXTRACT(EPOCH FROM now() - min(next_attempt_at))::int FROM publishing_jobs WHERE status = 'pending' AND next_attempt_at <= now()) AS oldest_pending_s,
        (SELECT count(*) FROM publishing_jobs WHERE status = 'scheduled')::int AS scheduled,
        (SELECT count(*) FROM publishing_jobs WHERE status = 'processing')::int AS leased,
        (SELECT count(*) FROM publishing_jobs WHERE status = 'processing' AND lease_until < now())::int AS lease_expired,
        (SELECT count(*) FROM publishing_jobs WHERE status = 'processing' AND needs_reconciliation)::int AS reconciling,
        (SELECT count(*) FROM publishing_jobs WHERE status = 'failed' AND updated_at > now() - interval '24 hours')::int AS failed_24h,
        (SELECT count(*) FROM publishing_jobs WHERE dead_lettered_at > now() - interval '24 hours')::int AS exhausted_24h,
        (SELECT count(*) FROM outbox_events WHERE dispatched_at IS NULL AND available_at <= now())::int AS outbox_due,
        (SELECT EXTRACT(EPOCH FROM now() - min(available_at))::int FROM outbox_events WHERE dispatched_at IS NULL AND available_at <= now()) AS outbox_oldest_s,
        (SELECT count(*) FROM "user")::int AS users,
        (SELECT count(*) FROM "user" WHERE "createdAt" > now() - interval '7 days')::int AS users_7d,
        (SELECT count(*) FROM workspaces)::int AS workspaces,
        (SELECT count(*) FROM billing_webhook_events WHERE status = 'failed')::int AS billing_webhooks_failed,
        (SELECT count(*) FROM media_assets WHERE status IN ('uploaded', 'ready'))::int AS media_objects,
        (SELECT COALESCE(sum(size_bytes), 0)::float8 FROM media_assets WHERE status IN ('uploaded', 'ready')) AS media_bytes,
        (SELECT COALESCE(sum(count), 0)::float8 FROM request_metrics WHERE minute >= now() - interval '7 days') AS requests_7d,
        (SELECT COALESCE(sum(count), 0)::int FROM request_metrics WHERE minute >= now() - interval '1 hour') AS requests_1h,
        (SELECT COALESCE(sum(count) FILTER (WHERE status >= 500), 0)::int FROM request_metrics WHERE minute >= now() - interval '1 hour') AS errors_1h,
        (SELECT min(minute) FROM request_metrics) AS metrics_since`).then((x) => x[0]!),
      gate(() => workerStatus(d.db)),
      // Row counts are the statistics collector's live-tuple estimate (exact counts would scan every table).
      q<{ name: string; total_bytes: number; rows: number }>(`SELECT s.relname AS name, pg_total_relation_size(s.relid)::float8 AS total_bytes, s.n_live_tup::float8 AS rows
         FROM pg_stat_user_tables s WHERE s.schemaname = 'public' ORDER BY 2 DESC LIMIT 12`),
      q<{ platform: string; active: number; needs_reauth: number; disconnected: number }>(`SELECT platform, count(*) FILTER (WHERE status = 'active')::int AS active,
         count(*) FILTER (WHERE status = 'needs_reauth')::int AS needs_reauth, count(*) FILTER (WHERE status = 'disconnected')::int AS disconnected
         FROM social_accounts GROUP BY 1 ORDER BY 2 DESC, 1`),
      q<{ platform: string; published_24h: number; failed_24h: number; published_7d: number; failed_7d: number }>(`SELECT platform,
         count(*) FILTER (WHERE status = 'published' AND published_at > now() - interval '24 hours')::int AS published_24h,
         count(*) FILTER (WHERE status = 'failed' AND updated_at > now() - interval '24 hours')::int AS failed_24h,
         count(*) FILTER (WHERE status = 'published' AND published_at > now() - interval '7 days')::int AS published_7d,
         count(*) FILTER (WHERE status = 'failed' AND updated_at > now() - interval '7 days')::int AS failed_7d
         FROM publishing_jobs WHERE updated_at > now() - interval '7 days' OR published_at > now() - interval '7 days' GROUP BY 1 ORDER BY 1`),
      q<{ plan: string; status: string; n: number }>(`SELECT p.key AS plan, s.status, count(*)::int AS n FROM billing_subscriptions s
         JOIN billing_plan_versions v ON v.id = s.plan_version_id JOIN billing_plans p ON p.id = v.plan_id WHERE s.status <> 'canceled' GROUP BY 1,2 ORDER BY 1,2`),
      q<{ id: string; platform: string; workspace_id: string; failure_kind: string | null; message: string | null; at: Date }>(`SELECT id, platform, workspace_id, failure_kind, left(failure_message, 200) AS message, updated_at AS at
         FROM publishing_jobs WHERE status = 'failed' ORDER BY updated_at DESC LIMIT 10`),
      q<{ queue: string; last24h: number; last7d: number }>(`SELECT route AS queue, count(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS last24h, count(*)::int AS last7d
         FROM server_errors WHERE source = 'dlq' AND created_at > now() - interval '7 days' GROUP BY 1 ORDER BY 1`),
    ]);
    const ok = <T>(s: PromiseSettledResult<T>) => (s.status === "fulfilled" ? s.value : null);
    for (const s of [scalars, workers, tables, accounts, publishing, subs, failures, dlq]) if (s.status === "rejected") d.log.error({ err: s.reason }, "ops overview section failed");
    const sc = ok(scalars), w = ok(workers);
    const liveLimitMb = Number(sc?.neon_max_mb);   // Neon exposes the storage cap on the compute; elsewhere fall back to the plan constant
    const dbLimitBytes = liveLimitMb > 0 ? liveLimitMb * 1024 * 1024 : PRICES.neon.storageLimitBytes;

    const requests1h = n(sc?.requests_1h), errors1h = n(sc?.errors_1h);
    const errorRate1h = requests1h ? (errors1h ?? 0) / requests1h : null;
    const reasons = [
      !ping.ok && "database unreachable",
      (n(sc?.outbox_oldest_s) ?? 0) > 300 && "outbox backlog older than 5 minutes",
      (n(sc?.lease_expired) ?? 0) > 0 && "publish jobs with expired leases",
      w && !w.scheduling?.alive && "cron has not ticked in 3 minutes",
      errorRate1h !== null && requests1h! >= 20 && errorRate1h > 0.05 && "5xx rate above 5% in the last hour",
    ].filter((x): x is string => Boolean(x));

    // Monthly projection from what we measured; with less than 7 days of data it extrapolates from the window we have.
    const since = sc?.metrics_since ? new Date(sc.metrics_since as string).getTime() : null;
    const windowMs = since ? Math.min(7 * 86_400_000, Math.max(3_600_000, Date.now() - since)) : null;
    const requestsPerMonth = windowMs && sc ? (n(sc.requests_7d)! / windowMs) * 30 * 86_400_000 : 0;

    res.json({
      data: {
        generatedAt: new Date().toISOString(),
        status: {
          overall: !ping.ok ? "down" : reasons.length ? "degraded" : "ok", reasons,
          api: "up", db: ping, workers: w,
          backlog: sc ? { outboxDue: n(sc.outbox_due), outboxOldestS: n(sc.outbox_oldest_s), jobsDue: n(sc.pending_due) } : null,
          errorRate1h: { requests: requests1h, errors5xx: errors1h, rate: errorRate1h },
          metricsSince: sc?.metrics_since ?? null,
        },
        database: {
          sizeBytes: n(sc?.db_bytes), planName: PRICES.neon.plan, planLimitBytes: dbLimitBytes, planLimitSource: liveLimitMb > 0 ? "neon.max_cluster_size" : "plan constant", latencyMs: ping.latencyMs,
          tables: ok(tables)?.map((t) => ({ name: t.name, totalBytes: Number(t.total_bytes), rows: Number(t.rows) })) ?? null,
        },
        queues: {
          jobs: sc ? { pending: n(sc.pending), pendingDue: n(sc.pending_due), scheduled: n(sc.scheduled), leased: n(sc.leased), leaseExpired: n(sc.lease_expired), reconciling: n(sc.reconciling), failed24h: n(sc.failed_24h), exhausted24h: n(sc.exhausted_24h), oldestPendingAgeS: n(sc.oldest_pending_s) } : null,
          outbox: sc ? { due: n(sc.outbox_due), oldestDueS: n(sc.outbox_oldest_s) } : null,
          dlq: ok(dlq),
          recentFailures: ok(failures)?.map((f) => ({ jobId: f.id, platform: f.platform, workspaceId: f.workspace_id, code: f.failure_kind, message: f.message, at: f.at })) ?? null,
        },
        business: {
          users: n(sc?.users), usersLast7d: n(sc?.users_7d), workspaces: n(sc?.workspaces),
          accountsByPlatform: ok(accounts)?.map((a) => ({ platform: a.platform, active: a.active, needsReauth: a.needs_reauth, disconnected: a.disconnected })) ?? null,
          publishingByPlatform: ok(publishing)?.map((p) => ({ platform: p.platform, published24h: p.published_24h, failed24h: p.failed_24h, published7d: p.published_7d, failed7d: p.failed_7d, successRate7d: p.published_7d + p.failed_7d ? p.published_7d / (p.published_7d + p.failed_7d) : null })) ?? null,
          subscriptions: ok(subs),
          billingWebhooksFailed: n(sc?.billing_webhooks_failed),
        },
        storage: sc ? { source: "media_assets", trackedObjects: n(sc.media_objects), trackedBytes: n(sc.media_bytes) } : null,
        costs: { ...estimateMonthlyCosts({ requestsPerMonth, dbBytes: n(sc?.db_bytes) ?? 0, r2Bytes: n(sc?.media_bytes) ?? 0, dbLimitBytes }), requestsPerMonthProjected: Math.round(requestsPerMonth) },
      },
    });
  });

  r.get("/admin/ops/metrics", validate({ query: z.object({ range: z.enum(["1h", "24h", "7d"]).default("24h") }) }), async (req, res) => {
    const range = RANGES[(req.query as unknown as { range: keyof typeof RANGES }).range];
    const [groups, series] = await Promise.all([
      q<{ route_group: string; le_ms: number; n: number; e5: number; e4: number; ms: number }>(`SELECT route_group, le_ms, sum(count)::int AS n,
         COALESCE(sum(count) FILTER (WHERE status >= 500), 0)::int AS e5, COALESCE(sum(count) FILTER (WHERE status BETWEEN 400 AND 499), 0)::int AS e4, sum(sum_ms)::float8 AS ms
         FROM request_metrics WHERE minute >= now() - $1::interval GROUP BY 1, 2`, [range.interval]),
      q<{ t: Date; le_ms: number; n: number; e5: number }>(`SELECT date_bin($2::interval, minute, timestamptz '1970-01-01 00:00:00+00') AS t, le_ms, sum(count)::int AS n,
         COALESCE(sum(count) FILTER (WHERE status >= 500), 0)::int AS e5 FROM request_metrics WHERE minute >= now() - $1::interval GROUP BY 1, 2`, [range.interval, range.bin]),
    ]);
    const byGroup = new Map<string, typeof groups>();
    for (const g of groups) byGroup.set(g.route_group, [...(byGroup.get(g.route_group) ?? []), g]);
    const byBin = new Map<number, typeof series>();
    for (const s of series) { const k = new Date(s.t).getTime(); byBin.set(k, [...(byBin.get(k) ?? []), s]); }
    // Continuous x-axis: empty bins are reported with count 0 and null latencies (no data), never interpolated.
    const end = Math.floor(Date.now() / range.binMs) * range.binMs, points = [];
    for (let t = end - range.ms + range.binMs; t <= end; t += range.binMs) { const s = summarize(byBin.get(t) ?? []); points.push({ t: new Date(t).toISOString(), count: s.count, errors5xx: s.errors5xx, p50: s.p50, p95: s.p95 }); }
    res.json({
      data: {
        range: (req.query as unknown as { range: string }).range, binSeconds: range.binMs / 1000,
        totals: summarize(groups),
        groups: [...byGroup].map(([group, rows]) => ({ group, ...summarize(rows) })).sort((a, b) => b.count - a.count),
        series: points,
      },
    });
  });

  r.get("/admin/ops/audit", validate({ query: z.object({ workspaceId: z.uuid().optional(), action: z.string().trim().min(1).max(100).optional(), ...page }) }), async (req, res) => {
    const p = req.query as unknown as { workspaceId?: string; action?: string; before?: number; limit: number };
    const [rows, actions] = await Promise.all([
      q<{ id: string; workspace_id: string | null; workspace_name: string | null; actor_id: string | null; actor_email: string | null; actor_name: string | null; action: string; entity_type: string | null; entity_id: string | null; request_id: string | null; created_at: Date }>(
        `SELECT a.id::text, a.workspace_id, w.name AS workspace_name, a.actor_id, u.email AS actor_email, u.name AS actor_name, a.action, a.entity_type, a.entity_id, a.request_id, a.created_at
           FROM audit_logs a LEFT JOIN workspaces w ON w.id = a.workspace_id LEFT JOIN "user" u ON u.id = a.actor_id
          WHERE ($1::uuid IS NULL OR a.workspace_id = $1) AND ($2::text IS NULL OR starts_with(a.action, $2)) AND ($3::bigint IS NULL OR a.id < $3)
          ORDER BY a.id DESC LIMIT $4`, [p.workspaceId ?? null, p.action ?? null, p.before ?? null, p.limit + 1]),
      q<{ action: string; n: number }>("SELECT action, count(*)::int AS n FROM audit_logs GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 50"),
    ]);
    const more = rows.length > p.limit, items = rows.slice(0, p.limit);
    res.json({
      data: items.map((a) => ({ id: a.id, workspaceId: a.workspace_id, workspaceName: a.workspace_name, actorId: a.actor_id, actorEmail: a.actor_email, actorName: a.actor_name, action: a.action, targetType: a.entity_type, targetId: a.entity_id, requestId: a.request_id, at: a.created_at })),
      meta: { nextBefore: more ? Number(items[items.length - 1]!.id) : null, actions },
    });
  });

  r.get("/admin/ops/errors", validate({ query: z.object({ source: z.enum(["http", "dlq"]).optional(), ...page }) }), async (req, res) => {
    const p = req.query as unknown as { source?: string; before?: number; limit: number };
    const rows = await q<{ id: string; source: string; route: string; method: string | null; request_id: string | null; message: string; created_at: Date }>(
      `SELECT id::text, source, route, method, request_id, message, created_at FROM server_errors
        WHERE ($1::text IS NULL OR source = $1) AND ($2::bigint IS NULL OR id < $2) ORDER BY id DESC LIMIT $3`, [p.source ?? null, p.before ?? null, p.limit + 1]);
    const more = rows.length > p.limit, items = rows.slice(0, p.limit);
    res.json({
      data: items.map((e) => ({ id: e.id, source: e.source, route: e.route, method: e.method, requestId: e.request_id, message: e.message, at: e.created_at })),
      meta: { nextBefore: more ? Number(items[items.length - 1]!.id) : null },
    });
  });
  return r;
}
