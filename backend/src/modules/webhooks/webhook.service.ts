import { createHmac, randomBytes } from "node:crypto";
import { z } from "zod";
import type { Db, Queryable } from "../../infrastructure/database/db.js";
import type { Cipher } from "../../infrastructure/encryption/cipher.js";
import type { Logger } from "../../infrastructure/logger/logger.js";
import { AppError, badRequest, notFound } from "../../shared/errors/errors.js";
import { decodeCursor, page } from "../../shared/utils/pagination.js";
import { auditRepository } from "../audit/audit.repository.js";
import type { Actor, WorkspaceService } from "../workspaces/workspace.service.js";
import { checkWebhookUrl } from "./webhook.url.js";

export const WEBHOOK_EVENTS = ["publication.published", "publication.failed", "account.reauth_required", "account.expiring", "approval.requested", "approval.decided", "series.occurrence_failed", "billing.subscription_activated", "billing.payment_failed", "billing.subscription_canceled", "ping"] as const;
const BACKOFF_S = [60, 300, 1800, 7200, 21600, 43200, 86400];     // 1m, 5m, 30m, 2h, 6h, 12h, 24h => 8 attempts over ~2 days
const AUTO_DISABLE_AFTER = 5;
const cursorSchema = z.object({ createdAt: z.string(), id: z.string() });

export interface WebhookEmitter { emit(q: Queryable, workspaceId: string, type: string, data: unknown, ref: string): Promise<number> }

/** `sign(secret, ts, body)` is what receivers must recompute: HMAC-SHA256 over "<timestamp>.<raw body>", hex. Reject timestamps older than a few minutes. */
export const sign = (secret: string, ts: number, body: string) => createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");

export function createWebhookService(deps: { db: Db; workspaces: WorkspaceService; cipher: Cipher | null; log: Logger; fetch?: typeof fetch; allowInsecure: boolean }) {
  const { db, workspaces } = deps;
  const f = deps.fetch ?? fetch;
  const cipher = () => { if (!deps.cipher) throw new AppError(503, "ENCRYPTION_NOT_CONFIGURED", "TOKEN_ENC_KEYS is not configured"); return deps.cipher; };
  const aad = (id: string) => `webhook:${id}`;
  const newSecret = () => `whsec_${randomBytes(32).toString("base64url")}`;
  const view = (e: { id: string; url: string; events: string[]; enabled: boolean; failure_streak: number; disabled_reason: string | null; created_at: string }) => ({ id: e.id, url: e.url, events: e.events, enabled: e.enabled, failureStreak: e.failure_streak, disabledReason: e.disabled_reason, createdAt: e.created_at });
  const COLS = "id, url, events, enabled, failure_streak, disabled_reason, created_at";
  const validateUrl = (url: string) => { const err = checkWebhookUrl(url, deps.allowInsecure); if (err) throw badRequest(err); };
  const validateEvents = (events: string[]) => { for (const e of events) if (e !== "*" && !(WEBHOOK_EVENTS as readonly string[]).includes(e)) throw badRequest(`Unknown event '${e}'`); };
  const audit = (a: Actor, ws: string, action: string, id: string) => auditRepository.record(db, { workspaceId: ws, actorId: a.id, action, entityType: "webhook", entityId: id, ...(a.requestId ? { requestId: a.requestId } : {}) });

  const emitter: WebhookEmitter = {
    /** Records one pending delivery per matching, enabled endpoint (idempotent by ref). Delivery itself happens in the background. */
    async emit(q, workspaceId, type, data, ref) {
      const eps = (await q.query<{ id: string }>("SELECT id FROM webhook_endpoints WHERE workspace_id = $1 AND enabled AND ($2 = ANY(events) OR '*' = ANY(events))", [workspaceId, type])).rows;
      let n = 0;
      for (const ep of eps)
        n += (await q.query("INSERT INTO webhook_deliveries (endpoint_id, workspace_id, event_type, payload, ref) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (endpoint_id, ref) DO NOTHING", [ep.id, workspaceId, type, JSON.stringify({ type, workspaceId, data }), ref])).rowCount;
      return n;
    },
  };

  return {
    emitter,
    events: () => WEBHOOK_EVENTS,

    async create(a: Actor, workspaceId: string, i: { url: string; events: string[] }) {
      await workspaces.authorize(a.id, workspaceId, "workspace:update");
      validateUrl(i.url); validateEvents(i.events);
      const count = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM webhook_endpoints WHERE workspace_id = $1", [workspaceId])).rows[0]!.n;
      if (count >= 10) throw new AppError(409, "WEBHOOK_LIMIT", "A workspace can have at most 10 webhook endpoints");
      const secret = newSecret();
      const id = crypto.randomUUID();
      const row = (await db.query<Parameters<typeof view>[0]>(`INSERT INTO webhook_endpoints (id, workspace_id, url, secret_enc, events, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${COLS}`, [id, workspaceId, i.url, await cipher().encrypt(secret, aad(id)), i.events, a.id])).rows[0]!;
      await audit(a, workspaceId, "webhook.created", id);
      return { ...view(row), secret };       // the only time the secret is ever returned
    },
    async list(a: Actor, workspaceId: string) {
      await workspaces.authorize(a.id, workspaceId, "workspace:update");
      return (await db.query<Parameters<typeof view>[0]>(`SELECT ${COLS} FROM webhook_endpoints WHERE workspace_id = $1 ORDER BY created_at`, [workspaceId])).rows.map(view);
    },
    async update(a: Actor, workspaceId: string, id: string, p: { url?: string | undefined; events?: string[] | undefined; enabled?: boolean | undefined }) {
      await workspaces.authorize(a.id, workspaceId, "workspace:update");
      if (p.url) validateUrl(p.url);
      if (p.events) validateEvents(p.events);
      const row = (await db.query<Parameters<typeof view>[0]>(
        `UPDATE webhook_endpoints SET url = COALESCE($3, url), events = COALESCE($4, events), enabled = COALESCE($5, enabled),
                failure_streak = CASE WHEN $5 IS TRUE THEN 0 ELSE failure_streak END, disabled_reason = CASE WHEN $5 IS TRUE THEN NULL ELSE disabled_reason END
          WHERE workspace_id = $1 AND id = $2 RETURNING ${COLS}`, [workspaceId, id, p.url ?? null, p.events ?? null, p.enabled ?? null])).rows[0];
      if (!row) throw notFound("Webhook");
      await audit(a, workspaceId, "webhook.updated", id);
      return view(row);
    },
    async rotateSecret(a: Actor, workspaceId: string, id: string) {
      await workspaces.authorize(a.id, workspaceId, "workspace:update");
      const secret = newSecret();
      if (!(await db.query("UPDATE webhook_endpoints SET secret_enc = $3 WHERE workspace_id = $1 AND id = $2", [workspaceId, id, await cipher().encrypt(secret, aad(id))])).rowCount) throw notFound("Webhook");
      await audit(a, workspaceId, "webhook.secret_rotated", id);
      return { id, secret };
    },
    async remove(a: Actor, workspaceId: string, id: string) {
      await workspaces.authorize(a.id, workspaceId, "workspace:update");
      if (!(await db.query("DELETE FROM webhook_endpoints WHERE workspace_id = $1 AND id = $2", [workspaceId, id])).rowCount) throw notFound("Webhook");
      await audit(a, workspaceId, "webhook.deleted", id);
    },
    /** Sends a `ping` so the receiver can confirm its signature check. */
    async ping(a: Actor, workspaceId: string, id: string) {
      await workspaces.authorize(a.id, workspaceId, "workspace:update");
      const ep = (await db.query("SELECT 1 FROM webhook_endpoints WHERE workspace_id = $1 AND id = $2", [workspaceId, id])).rowCount;
      if (!ep) throw notFound("Webhook");
      const ref = `ping:${crypto.randomUUID()}`;
      await db.query("INSERT INTO webhook_deliveries (endpoint_id, workspace_id, event_type, payload, ref) VALUES ($1,$2,'ping',$3,$4)", [id, workspaceId, JSON.stringify({ type: "ping", workspaceId, data: { message: "pong" } }), ref]);
      return { queued: true };
    },
    async deliveries(a: Actor, workspaceId: string, id: string, p: { limit: number; cursor?: string | undefined }) {
      await workspaces.authorize(a.id, workspaceId, "workspace:update");
      if (!(await db.query("SELECT 1 FROM webhook_endpoints WHERE workspace_id = $1 AND id = $2", [workspaceId, id])).rowCount) throw notFound("Webhook");
      const after = decodeCursor(p.cursor, cursorSchema);
      const rows = (await db.query<{ id: string; event_type: string; status: string; attempts: number; next_attempt_at: string; last_status: number | null; last_error: string | null; created_at: string; delivered_at: string | null }>(
        `SELECT id, event_type, status, attempts, next_attempt_at, last_status, last_error, created_at, delivered_at FROM webhook_deliveries WHERE workspace_id = $1 AND endpoint_id = $2
          AND ($3::timestamptz IS NULL OR (created_at, id) < ($3::timestamptz, $4::uuid)) ORDER BY created_at DESC, id DESC LIMIT $5`, [workspaceId, id, after?.createdAt ?? null, after?.id ?? null, p.limit + 1])).rows;
      return page(rows, p.limit, (r) => ({ createdAt: r.created_at, id: r.id }));
    },

    // ---- background delivery
    async sweep(limit = 25) {
      const due = (await db.tx((q) => q.query<{ id: string; endpoint_id: string; payload: unknown; attempts: number; url: string; secret_enc: string; workspace_id: string; event_type: string; failure_streak: number }>(
        // claim with a visibility window longer than a full batch (25 x 10 s timeout) so overlapping sweeps never deliver the same event twice
        `UPDATE webhook_deliveries d SET next_attempt_at = now() + interval '15 minutes' FROM webhook_endpoints e
          WHERE d.id IN (SELECT id FROM webhook_deliveries WHERE status = 'pending' AND next_attempt_at <= now() ORDER BY next_attempt_at LIMIT $1 FOR UPDATE SKIP LOCKED) AND e.id = d.endpoint_id
          RETURNING d.id, d.endpoint_id, d.payload, d.attempts, e.url, e.secret_enc, d.workspace_id, d.event_type, e.failure_streak`, [limit]))).rows;
      let delivered = 0, failed = 0;
      for (const d of due) {
        const body = JSON.stringify(d.payload);
        const ts = Math.floor(Date.now() / 1000);
        let status = 0, error: string | null = null;
        try {
          const secret = await cipher().decrypt(d.secret_enc, aad(d.endpoint_id));
          const res = await f(d.url, {
            method: "POST", redirect: "manual", signal: AbortSignal.timeout(10_000),
            headers: { "Content-Type": "application/json", "User-Agent": "social-platform-webhooks/1", "X-Webhook-Id": d.id, "X-Webhook-Event": d.event_type, "X-Webhook-Timestamp": String(ts), "X-Webhook-Signature": `t=${ts},v1=${sign(secret, ts, body)}` },
            body,
          });
          status = res.status;
          if (res.status < 200 || res.status >= 300) error = `receiver answered ${res.status}`;
        } catch (e) { error = `delivery failed: ${(e as Error).name === "TimeoutError" ? "timeout" : (e as Error).message.slice(0, 120)}`; }
        const attempts = d.attempts + 1;
        if (!error) {
          await db.tx(async (q) => {
            await q.query("UPDATE webhook_deliveries SET status = 'delivered', attempts = $2, last_status = $3, last_error = NULL, delivered_at = now() WHERE id = $1", [d.id, attempts, status]);
            await q.query("UPDATE webhook_endpoints SET failure_streak = 0 WHERE id = $1", [d.endpoint_id]);
          });
          delivered++; continue;
        }
        const gone = status === 410;                                   // receiver says the endpoint is permanently gone
        const exhausted = attempts > BACKOFF_S.length;
        await db.tx(async (q) => {
          if (gone || exhausted) {
            await q.query("UPDATE webhook_deliveries SET status = 'failed', attempts = $2, last_status = $3, last_error = $4 WHERE id = $1", [d.id, attempts, status || null, error]);
            const streak = d.failure_streak + 1;
            await q.query("UPDATE webhook_endpoints SET failure_streak = $2::int, enabled = CASE WHEN $3::boolean OR $2::int >= $4::int THEN false ELSE enabled END, disabled_reason = CASE WHEN $3::boolean THEN 'receiver returned 410 Gone' WHEN $2::int >= $4::int THEN 'too many consecutive failed deliveries' ELSE disabled_reason END WHERE id = $1", [d.endpoint_id, streak, gone, AUTO_DISABLE_AFTER]);
            failed++;
          } else {
            await q.query("UPDATE webhook_deliveries SET attempts = $2, last_status = $3, last_error = $4, next_attempt_at = now() + make_interval(secs => $5) WHERE id = $1", [d.id, attempts, status || null, error, BACKOFF_S[attempts - 1]]);
          }
        });
      }
      return { due: due.length, delivered, failed };
    },
    async purge() { return (await db.query("DELETE FROM webhook_deliveries WHERE created_at < now() - interval '30 days' AND status <> 'pending'")).rowCount; },
  };
}
export type WebhookService = ReturnType<typeof createWebhookService>;
