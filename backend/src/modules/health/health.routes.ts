import { Router } from "express";
import type { Db } from "../../infrastructure/database/db.js";
import { workerStatus } from "../../workers/heartbeat.js";
import { opsAuth } from "../../shared/middleware/ops-auth.js";

const withTimeout = <T>(p: Promise<T>, ms = 3000) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

export function healthRoutes(deps: { db: Db; opsToken?: string | undefined }) {
  const r = Router();
  // Liveness: isolate is up. No dependency checks.
  r.get("/health/live", (_req, res) => res.json({ data: { status: "ok" } }));
  // Readiness: database reachable.
  r.get("/health/ready", async (_req, res) => {
    const t = Date.now();
    try {
      await withTimeout(deps.db.query("SELECT 1"));
      res.json({ data: { status: "ok", checks: { db: { ok: true, ms: Date.now() - t } } } });
    } catch {
      res.status(503).json({ data: { status: "degraded", checks: { db: { ok: false, ms: Date.now() - t } } } });
    }
  });
  // Informational: scheduled/queue handlers heartbeat into Postgres.
  r.get("/health/workers", async (_req, res) => {
    try {
      res.json({ data: await withTimeout(workerStatus(deps.db)) });
    } catch {
      res.status(503).json({ error: { code: "DB_UNAVAILABLE", message: "Cannot read worker status" } });
    }
  });
  // Backlog and failure counters derived from Postgres (Cloudflare Queues has no depth API for Workers). For uptime monitors / alerting.
  // Disabled (404) unless OPS_TOKEN is configured; compared in constant time.
  r.get("/health/queues", opsAuth(deps.opsToken), async (req, res) => {
    try {
      const q = (await withTimeout(deps.db.query<Record<string, number | null>>(
        `SELECT
           (SELECT count(*) FROM outbox_events WHERE type = 'publish_job' AND dispatched_at IS NULL AND available_at <= now())::int AS outbox_due,
           (SELECT EXTRACT(EPOCH FROM now() - min(available_at))::int FROM outbox_events WHERE type = 'publish_job' AND dispatched_at IS NULL AND available_at <= now()) AS outbox_oldest_due_s,
           (SELECT count(*) FROM publishing_jobs WHERE status = 'pending' AND next_attempt_at <= now())::int AS jobs_due,
           (SELECT count(*) FROM publishing_jobs WHERE status = 'scheduled')::int AS jobs_scheduled,
           (SELECT count(*) FROM publishing_jobs WHERE status = 'processing')::int AS jobs_processing,
           (SELECT count(*) FROM publishing_jobs WHERE status = 'processing' AND lease_until < now())::int AS jobs_lease_expired,
           (SELECT count(*) FROM publishing_jobs WHERE status = 'processing' AND needs_reconciliation)::int AS jobs_reconciling,
           (SELECT count(*) FROM publishing_jobs WHERE status = 'failed' AND updated_at > now() - interval '24 hours')::int AS jobs_failed_24h,
           (SELECT count(*) FROM publishing_jobs WHERE dead_lettered_at > now() - interval '24 hours')::int AS jobs_dead_lettered_24h,
           (SELECT count(*) FROM analytics_targets WHERE status = 'active' AND next_collect_at <= now())::int AS analytics_due,
           (SELECT count(*) FROM analytics_targets WHERE status = 'disabled')::int AS analytics_disabled,
           (SELECT count(*) FROM outbox_events WHERE type = 'notification_email' AND dispatched_at IS NULL)::int AS emails_pending,
           (SELECT count(*) FROM export_jobs WHERE status IN ('queued','running'))::int AS exports_pending`))).rows[0]!;
      const degraded = (q.outbox_oldest_due_s ?? 0) > 300 || (q.jobs_lease_expired ?? 0) > 0;
      res.status(degraded ? 503 : 200).json({ data: { status: degraded ? "degraded" : "ok", ...q } });
    } catch {
      res.status(503).json({ error: { code: "DB_UNAVAILABLE", message: "Cannot read queue state", requestId: req.id } });
    }
  });
  return r;
}
