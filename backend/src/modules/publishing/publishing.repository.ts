import type { Queryable } from "../../infrastructure/database/db.js";
import type { JobStatus } from "./publishing.state-machine.js";

export interface JobRow {
  id: string; workspace_id: string; post_id: string; variant_id: string; social_account_id: string; platform: string; status: JobStatus;
  next_attempt_at: string; attempt_count: number; max_attempts: number; lease_token: string | null; lease_until: string | null;
  needs_reconciliation: boolean; unknown_since: string | null; idempotency_key: string; external_id: string | null; external_url: string | null;
  published_at: string | null; failure_kind: string | null; failure_message: string | null; dead_lettered_at: string | null; created_at: string; updated_at: string;
}
// Columns safe to return from the API (no lease token).
const PUBLIC = "id, post_id, variant_id, social_account_id, platform, status, next_attempt_at, attempt_count, max_attempts, needs_reconciliation, external_id, external_url, published_at, failure_kind, failure_message, dead_lettered_at, created_at, updated_at";
const ALL = `${PUBLIC}, workspace_id, lease_token, lease_until, unknown_since, idempotency_key`;

export const publishingRepository = {
  insertJob: async (q: Queryable, j: { workspaceId: string; postId: string; variantId: string; accountId: string; platform: string; status: "pending" | "scheduled"; runAt: Date; userId: string }) =>
    (await q.query<JobRow>(
      `INSERT INTO publishing_jobs (workspace_id, post_id, variant_id, social_account_id, platform, status, next_attempt_at, created_by, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, 'pub:' || gen_random_uuid()::text) RETURNING ${ALL}`,
      [j.workspaceId, j.postId, j.variantId, j.accountId, j.platform, j.status, j.runAt.toISOString(), j.userId])).rows[0]!,
  /**
   * Variants that must NOT get a new job from `publish`: live ones (also enforced by a unique index) and failed ones, which
   * must go through `retry` so history is kept and an 'unconfirmed' failure can warn about a possible duplicate.
   */
  blockedVariantIds: async (q: Queryable, workspaceId: string, postId: string) =>
    new Set((await q.query<{ variant_id: string }>("SELECT variant_id FROM publishing_jobs WHERE workspace_id = $1 AND post_id = $2 AND status IN ('pending','scheduled','processing','published','failed')", [workspaceId, postId])).rows.map((r) => r.variant_id)),
  markPostSubmitted: (q: Queryable, workspaceId: string, postId: string) => q.query("UPDATE posts SET status = 'submitted' WHERE workspace_id = $1 AND id = $2", [workspaceId, postId]),
  event: (q: Queryable, e: { jobId: string; workspaceId: string; from: JobStatus | null; to: JobStatus; reason?: string; actorId?: string }) =>
    q.query("INSERT INTO publishing_events (job_id, workspace_id, from_status, to_status, reason, actor_id) VALUES ($1,$2,$3,$4,$5,$6)", [e.jobId, e.workspaceId, e.from, e.to, e.reason ?? null, e.actorId ?? null]),
  enqueueOutbox: (q: Queryable, workspaceId: string, jobId: string, availableAt: Date) =>
    q.query("INSERT INTO outbox_events (workspace_id, type, aggregate_id, available_at) VALUES ($1,'publish_job',$2,$3)", [workspaceId, jobId, availableAt.toISOString()]),

  // ---- idempotency
  claimIdempotencyKey: async (q: Queryable, workspaceId: string, key: string, postId: string) =>
    (await q.query("INSERT INTO idempotency_keys (workspace_id, key, post_id, response) VALUES ($1,$2,$3,'null') ON CONFLICT DO NOTHING", [workspaceId, key, postId])).rowCount === 1,
  getIdempotent: async (q: Queryable, workspaceId: string, key: string) =>
    (await q.query<{ post_id: string; response: unknown }>("SELECT post_id, response FROM idempotency_keys WHERE workspace_id = $1 AND key = $2", [workspaceId, key])).rows[0] ?? null,
  saveIdempotent: (q: Queryable, workspaceId: string, key: string, response: unknown) =>
    q.query("UPDATE idempotency_keys SET response = $3 WHERE workspace_id = $1 AND key = $2", [workspaceId, key, JSON.stringify(response)]),

  // ---- user-facing reads (always workspace-scoped)
  getJob: async (q: Queryable, workspaceId: string, jobId: string) =>
    (await q.query<JobRow>(`SELECT ${PUBLIC} FROM publishing_jobs WHERE workspace_id = $1 AND id = $2`, [workspaceId, jobId])).rows[0] ?? null,
  lockJob: async (q: Queryable, workspaceId: string, jobId: string) =>
    (await q.query<JobRow>(`SELECT ${ALL} FROM publishing_jobs WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, jobId])).rows[0] ?? null,
  listJobs: (q: Queryable, workspaceId: string, f: { limit: number; status?: string | undefined; platform?: string | undefined; postId?: string | undefined; after?: { createdAt: string; id: string } | undefined }) =>
    q.query<JobRow>(
      `SELECT ${PUBLIC} FROM publishing_jobs WHERE workspace_id = $1 AND ($2::text IS NULL OR status = $2) AND ($3::text IS NULL OR platform = $3) AND ($4::uuid IS NULL OR post_id = $4)
         AND ($5::timestamptz IS NULL OR (created_at, id) < ($5::timestamptz, $6::uuid)) ORDER BY created_at DESC, id DESC LIMIT $7`,
      [workspaceId, f.status ?? null, f.platform ?? null, f.postId ?? null, f.after?.createdAt ?? null, f.after?.id ?? null, f.limit + 1]),
  attempts: (q: Queryable, workspaceId: string, jobId: string) =>
    q.query("SELECT attempt_no, outcome, error_message, http_status, started_at, finished_at FROM publishing_attempts WHERE workspace_id = $1 AND job_id = $2 ORDER BY attempt_no", [workspaceId, jobId]),
  events: (q: Queryable, workspaceId: string, jobId: string) =>
    q.query("SELECT from_status, to_status, reason, actor_id, created_at FROM publishing_events WHERE workspace_id = $1 AND job_id = $2 ORDER BY id", [workspaceId, jobId]),

  cancel: async (q: Queryable, workspaceId: string, jobId: string) =>
    (await q.query("UPDATE publishing_jobs SET status = 'cancelled' WHERE workspace_id = $1 AND id = $2 AND status IN ('pending','scheduled')", [workspaceId, jobId])).rowCount,
  retry: async (q: Queryable, workspaceId: string, jobId: string) =>
    (await q.query(
      `UPDATE publishing_jobs SET status = 'pending', max_attempts = attempt_count + 5, next_attempt_at = now(), failure_kind = NULL, failure_message = NULL,
         dead_lettered_at = NULL, needs_reconciliation = false, unknown_since = NULL WHERE workspace_id = $1 AND id = $2 AND status = 'failed'`, [workspaceId, jobId])).rowCount,

  // ---- engine (internal; workspace comes from the job row itself)
  /** Atomic claim. Exactly one concurrent caller gets the row; all others get null. */
  claim: async (q: Queryable, jobId: string, leaseToken: string, leaseSeconds: number) =>
    (await q.query<JobRow>(
      `UPDATE publishing_jobs SET status = 'processing', lease_token = $2, lease_until = now() + make_interval(secs => $3), attempt_count = attempt_count + 1, needs_reconciliation = false
        WHERE id = $1 AND status IN ('pending','scheduled') AND next_attempt_at <= now() RETURNING ${ALL}`, [jobId, leaseToken, leaseSeconds])).rows[0] ?? null,
  startAttempt: (q: Queryable, j: JobRow) => q.query("INSERT INTO publishing_attempts (job_id, workspace_id, attempt_no, outcome) VALUES ($1,$2,$3,'started')", [j.id, j.workspace_id, j.attempt_count]),
  finishAttempt: (q: Queryable, j: Pick<JobRow, "id" | "attempt_count">, outcome: string, f: { message?: string | undefined; httpStatus?: number | undefined; response?: unknown } = {}) =>
    q.query(
      "UPDATE publishing_attempts SET outcome = $3, error_message = $4, http_status = $5, response = $6, finished_at = now() WHERE job_id = $1 AND attempt_no = $2",
      [j.id, j.attempt_count, outcome, f.message?.slice(0, 1000) ?? null, f.httpStatus ?? null, f.response === undefined ? null : JSON.stringify(f.response).slice(0, 20_000)]),
  // All finishing updates are fenced by lease_token: a worker whose lease was lost can't overwrite the new owner's state.
  markPublished: async (q: Queryable, j: JobRow, r: { externalId: string; url?: string | undefined }) =>
    (await q.query(
      `UPDATE publishing_jobs SET status = 'published', external_id = $3, external_url = $4, published_at = now(), lease_token = NULL, lease_until = NULL, needs_reconciliation = false, failure_kind = NULL, failure_message = NULL
        WHERE id = $1 AND lease_token = $2 AND status = 'processing'`, [j.id, j.lease_token, r.externalId, r.url ?? null])).rowCount,
  /** Metering: one unit per job that really published. Keyed, so lease races, retries and reconciliation record it once. */
  recordPublishedUsage: (q: Queryable, j: { id: string; workspace_id: string }) =>
    q.query("INSERT INTO billing_usage_events (workspace_id, feature_key, quantity, idempotency_key) VALUES ($1,'posts_per_month',1,$2) ON CONFLICT (workspace_id, idempotency_key) DO NOTHING", [j.workspace_id, `published:${j.id}`]),
  markRetry: async (q: Queryable, j: JobRow, delayS: number, kind: string, message: string) =>
    (await q.query<{ next_attempt_at: string }>(
      `UPDATE publishing_jobs SET status = 'pending', next_attempt_at = now() + make_interval(secs => $3), lease_token = NULL, lease_until = NULL, failure_kind = $4, failure_message = $5
        WHERE id = $1 AND lease_token = $2 AND status = 'processing' RETURNING next_attempt_at`, [j.id, j.lease_token, delayS, kind, message.slice(0, 1000)])).rows[0] ?? null,
  markFailed: async (q: Queryable, j: JobRow, kind: string, message: string) =>
    (await q.query(
      `UPDATE publishing_jobs SET status = 'failed', lease_token = NULL, lease_until = NULL, needs_reconciliation = false, failure_kind = $3, failure_message = $4,
         dead_lettered_at = CASE WHEN $3 = 'exhausted' THEN now() ELSE dead_lettered_at END
        WHERE id = $1 AND lease_token = $2 AND status = 'processing'`, [j.id, j.lease_token, kind, message.slice(0, 1000)])).rowCount,
  markUnknown: async (q: Queryable, j: JobRow, message: string) =>
    (await q.query(
      `UPDATE publishing_jobs SET needs_reconciliation = true, unknown_since = COALESCE(unknown_since, now()), lease_until = NULL, failure_message = $3
        WHERE id = $1 AND lease_token = $2 AND status = 'processing'`, [j.id, j.lease_token, message.slice(0, 1000)])).rowCount,

  // ---- sweeper
  dueOutbox: (q: Queryable, limit: number) =>
    q.query<{ id: string; aggregate_id: string }>(
      "SELECT id, aggregate_id FROM outbox_events WHERE type = 'publish_job' AND dispatched_at IS NULL AND available_at <= now() ORDER BY available_at, id LIMIT $1 FOR UPDATE SKIP LOCKED", [limit]),
  markOutboxDispatched: (q: Queryable, ids: string[], jobIds: string[]) =>
    Promise.all([
      q.query("UPDATE outbox_events SET dispatched_at = now() WHERE id = ANY($1::bigint[])", [ids]),
      q.query("UPDATE publishing_jobs SET last_enqueued_at = now() WHERE id = ANY($1::uuid[])", [jobIds]),
    ]),
  /** Healing: due jobs that no queue message/outbox row is responsible for (lost message, expired retention, Redis-style loss). */
  orphanedDueJobs: (q: Queryable, limit: number) =>
    q.query<{ id: string; workspace_id: string }>(
      `SELECT j.id, j.workspace_id FROM publishing_jobs j
        WHERE j.status IN ('pending','scheduled') AND j.next_attempt_at <= now() - interval '1 minute'
          AND (j.last_enqueued_at IS NULL OR j.last_enqueued_at < now() - interval '5 minutes')
          AND NOT EXISTS (SELECT 1 FROM outbox_events o WHERE o.aggregate_id = j.id AND o.dispatched_at IS NULL)
        ORDER BY j.next_attempt_at LIMIT $1`, [limit]),
  /** A processing job whose lease expired belonged to a crashed/timed-out worker: the platform call may or may not have happened. */
  expireLeases: async (q: Queryable, limit: number) =>
    (await q.query<{ id: string; workspace_id: string }>(
      `UPDATE publishing_jobs SET needs_reconciliation = true, unknown_since = COALESCE(unknown_since, now()), lease_until = NULL, failure_message = 'Worker lease expired mid-publish'
        WHERE id IN (SELECT id FROM publishing_jobs WHERE status = 'processing' AND lease_until IS NOT NULL AND lease_until < now() ORDER BY lease_until LIMIT $1 FOR UPDATE SKIP LOCKED)
        RETURNING id, workspace_id`, [limit])).rows,
  reconcilable: (q: Queryable, limit: number) =>
    q.query<JobRow & { unknown_age_s: number }>(`SELECT ${ALL}, EXTRACT(EPOCH FROM now() - unknown_since)::float8 AS unknown_age_s FROM publishing_jobs WHERE status = 'processing' AND needs_reconciliation AND lease_until IS NULL ORDER BY unknown_since LIMIT $1`, [limit]),
  /** Reconciler takes ownership of an unknown-outcome job by setting a short lease (prevents concurrent reconcilers). */
  leaseForReconcile: async (q: Queryable, jobId: string, token: string, seconds: number) =>
    (await q.query<JobRow>(`UPDATE publishing_jobs SET lease_token = $2, lease_until = now() + make_interval(secs => $3) WHERE id = $1 AND status = 'processing' AND needs_reconciliation AND lease_until IS NULL RETURNING ${ALL}`, [jobId, token, seconds])).rows[0] ?? null,
  releaseReconcileLease: (q: Queryable, jobId: string, token: string) =>
    q.query("UPDATE publishing_jobs SET lease_until = NULL WHERE id = $1 AND lease_token = $2 AND status = 'processing'", [jobId, token]),
  /** Reconciler markers use the same fenced finishers; this resets the lease_token expectations. */
  stats: async (q: Queryable) =>
    (await q.query<{ status: string; n: string }>("SELECT status, count(*)::text AS n FROM publishing_jobs GROUP BY status")).rows,

  // ---- scheduling
  conflicts: (q: Queryable, workspaceId: string, accountIds: string[], at: Date, windowMin: number, excludePostId: string) =>
    q.query<{ id: string; post_id: string; social_account_id: string; next_attempt_at: string }>(
      `SELECT id, post_id, social_account_id, next_attempt_at FROM publishing_jobs
        WHERE workspace_id = $1 AND social_account_id = ANY($2::uuid[]) AND status IN ('scheduled','pending') AND post_id <> $3
          AND next_attempt_at BETWEEN $4::timestamptz - make_interval(mins => $5) AND $4::timestamptz + make_interval(mins => $5)
        ORDER BY next_attempt_at LIMIT 20`, [workspaceId, accountIds, excludePostId, at.toISOString(), windowMin]),
  upsertSchedule: (q: Queryable, s: { workspaceId: string; postId: string; at: Date; timezone: string; userId: string }) =>
    q.query(
      `INSERT INTO scheduled_posts (workspace_id, post_id, scheduled_at, timezone, status, created_by) VALUES ($1,$2,$3,$4,'active',$5)
       ON CONFLICT (post_id) DO UPDATE SET scheduled_at = EXCLUDED.scheduled_at, timezone = EXCLUDED.timezone, status = 'active'`,
      [s.workspaceId, s.postId, s.at.toISOString(), s.timezone, s.userId]),
  getSchedule: async (q: Queryable, workspaceId: string, postId: string) =>
    (await q.query<{ id: string; post_id: string; scheduled_at: string; timezone: string; status: string; scheduled_jobs: number }>(
      `SELECT s.id, s.post_id, s.scheduled_at, s.timezone, s.status,
              (SELECT count(*)::int FROM publishing_jobs j WHERE j.post_id = s.post_id AND j.workspace_id = s.workspace_id AND j.status = 'scheduled') AS scheduled_jobs
         FROM scheduled_posts s WHERE s.workspace_id = $1 AND s.post_id = $2`, [workspaceId, postId])).rows[0] ?? null,
  /** Jobs still waiting for their time (not yet claimed/queued). */
  scheduledJobs: async (q: Queryable, workspaceId: string, postId: string) =>
    (await q.query<{ id: string; social_account_id: string }>("SELECT id, social_account_id FROM publishing_jobs WHERE workspace_id = $1 AND post_id = $2 AND status = 'scheduled' AND next_attempt_at > now() FOR UPDATE", [workspaceId, postId])).rows,
  moveScheduled: async (q: Queryable, workspaceId: string, jobIds: string[], at: Date) =>
    (await q.query<{ id: string }>("UPDATE publishing_jobs SET next_attempt_at = $3, last_enqueued_at = NULL WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND status = 'scheduled' RETURNING id", [workspaceId, jobIds, at.toISOString()])).rows.map((r) => r.id),
  cancelScheduled: async (q: Queryable, workspaceId: string, jobIds: string[]) =>
    (await q.query<{ id: string }>("UPDATE publishing_jobs SET status = 'cancelled' WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND status = 'scheduled' RETURNING id", [workspaceId, jobIds])).rows.map((r) => r.id),
  dropPendingOutbox: (q: Queryable, jobIds: string[]) => q.query("DELETE FROM outbox_events WHERE aggregate_id = ANY($1::uuid[]) AND dispatched_at IS NULL", [jobIds]),
  cancelSchedule: (q: Queryable, workspaceId: string, postId: string) => q.query("UPDATE scheduled_posts SET status = 'cancelled' WHERE workspace_id = $1 AND post_id = $2", [workspaceId, postId]),
  postHasJobs: async (q: Queryable, workspaceId: string, postId: string) =>
    (await q.query<{ n: number }>("SELECT count(*)::int AS n FROM publishing_jobs WHERE workspace_id = $1 AND post_id = $2 AND status <> 'cancelled'", [workspaceId, postId])).rows[0]!.n > 0,
  reopenPost: (q: Queryable, workspaceId: string, postId: string) => q.query("UPDATE posts SET status = 'draft' WHERE workspace_id = $1 AND id = $2 AND status = 'submitted'", [workspaceId, postId]),
  /** Missed-job policy: a scheduled job that is hours overdue (outage) is NOT published late silently; the user decides. */
  expireMissed: async (q: Queryable, hours: number, limit: number) =>
    (await q.query<{ id: string; workspace_id: string }>(
      `UPDATE publishing_jobs SET status = 'failed', failure_kind = 'missed', dead_lettered_at = now(),
              failure_message = 'Not published: the scheduled time passed more than ' || $1::text || ' hours ago while the system was unavailable. Retry to publish now.'
        WHERE id IN (SELECT id FROM publishing_jobs WHERE status = 'scheduled' AND next_attempt_at < now() - make_interval(hours => $1) ORDER BY next_attempt_at LIMIT $2 FOR UPDATE SKIP LOCKED)
        RETURNING id, workspace_id`, [hours, limit])).rows,
  calendar: (q: Queryable, workspaceId: string, f: { from: Date; to: Date; platform?: string | undefined; status?: string | undefined; limit: number }) =>
    q.query<{ id: string; post_id: string; social_account_id: string; platform: string; status: string; at: string; title: string | null; preview: string; account_name: string }>(
      `SELECT j.id, j.post_id, j.social_account_id, j.platform, j.status, COALESCE(j.published_at, j.next_attempt_at) AS at, p.title, left(p.body, 140) AS preview, a.display_name AS account_name
         FROM publishing_jobs j JOIN posts p ON p.id = j.post_id AND p.workspace_id = j.workspace_id JOIN social_accounts a ON a.id = j.social_account_id AND a.workspace_id = j.workspace_id
        WHERE j.workspace_id = $1
          AND ((j.published_at >= $2 AND j.published_at < $3) OR (j.published_at IS NULL AND j.next_attempt_at >= $2 AND j.next_attempt_at < $3))   -- two sargable branches (one index each) instead of COALESCE()
          AND ($4::text IS NULL OR j.platform = $4) AND ($5::text IS NULL OR j.status = $5)
        ORDER BY at, j.id LIMIT $6`, [workspaceId, f.from.toISOString(), f.to.toISOString(), f.platform ?? null, f.status ?? null, f.limit]),
  draftsWithoutJobs: (q: Queryable, workspaceId: string, limit: number) =>
    q.query<{ id: string; title: string | null; preview: string; created_at: string }>(
      `SELECT p.id, p.title, left(p.body, 140) AS preview, p.created_at FROM posts p
        WHERE p.workspace_id = $1 AND p.status = 'draft' AND NOT EXISTS (SELECT 1 FROM publishing_jobs j WHERE j.post_id = p.id AND j.status <> 'cancelled')
        ORDER BY p.created_at DESC LIMIT $2`, [workspaceId, limit]),
  statuses: (q: Queryable, workspaceId: string, ids: string[]) =>
    q.query<{ id: string; status: string; platform: string; failure_kind: string | null; external_url: string | null }>("SELECT id, status, platform, failure_kind, external_url FROM publishing_jobs WHERE workspace_id = $1 AND id = ANY($2::uuid[])", [workspaceId, ids]),
};
