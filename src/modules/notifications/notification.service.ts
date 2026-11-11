import { z } from "zod";
import type { Db, Queryable } from "../../infrastructure/database/db.js";
import type { Mailer } from "../../infrastructure/email/resend.js";
import type { Logger } from "../../infrastructure/logger/logger.js";
import { notFound } from "../../shared/errors/errors.js";
import { decodeCursor, page } from "../../shared/utils/pagination.js";
import type { WebhookEmitter } from "../webhooks/webhook.service.js";
import { can, type Permission, type Role } from "../workspaces/permissions.js";
import type { Actor, WorkspaceService } from "../workspaces/workspace.service.js";
import { notificationRepository as repo } from "./notification.repository.js";

export const NOTIFICATION_TYPES = ["publish_succeeded", "publish_failed", "account_reauth_required", "account_expiring", "approval_requested", "approval_decided", "series_occurrence_failed"] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
/** Email defaults: only things that need attention. Success pings stay in-app. */
const EMAIL_DEFAULT: Record<NotificationType, boolean> = { publish_succeeded: false, publish_failed: true, account_reauth_required: true, account_expiring: true, approval_requested: true, approval_decided: true, series_occurrence_failed: true };
const WEBHOOK_TYPE: Record<NotificationType, string> = { publish_succeeded: "publication.published", publish_failed: "publication.failed", account_reauth_required: "account.reauth_required", account_expiring: "account.expiring", approval_requested: "approval.requested", approval_decided: "approval.decided", series_occurrence_failed: "series.occurrence_failed" };
const cursorSchema = z.object({ createdAt: z.string(), id: z.string() });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface NotifyInput { workspaceId: string; userIds: string[]; type: NotificationType; title: string; body: string; data?: object; ref: string }

export function createNotificationService(deps: { db: Db; workspaces: WorkspaceService; mailer: Mailer; log: Logger; appUrl?: string | undefined; webhooks?: WebhookEmitter | undefined; producerLagS?: number }) {
  const { db, workspaces } = deps;

  /** Idempotent per (user, type, ref). In-app row immediately; email goes through the outbox and is delivered asynchronously. */
  async function notify(q: Queryable, n: NotifyInput) {
    // Workspace-level webhook subscribers hear about the event once, regardless of how many users are notified.
    await deps.webhooks?.emit(q, n.workspaceId, WEBHOOK_TYPE[n.type], { title: n.title, body: n.body, ...(n.data ?? {}) }, n.ref);
    const users = [...new Set(n.userIds)];
    if (!users.length) return 0;
    const prefs = new Map((await repo.prefs(q, n.workspaceId, users, n.type)).rows.map((p) => [p.user_id, p]));
    let created = 0;
    for (const userId of users) {
      const p = prefs.get(userId);
      if (p && !p.in_app && !p.email) continue;
      const id = await repo.insert(q, { workspaceId: n.workspaceId, userId, type: n.type, title: n.title, body: n.body, data: n.data ?? {}, ref: n.ref });
      if (!id) continue;                                           // already notified for this event
      created++;
      if (p ? p.email : EMAIL_DEFAULT[n.type]) await repo.queueEmail(q, n.workspaceId, id);
    }
    return created;
  }
  /** Members who hold a permission (e.g. reviewers). */
  const holders = async (q: Queryable, workspaceId: string, permission: Permission, except?: string) =>
    (await repo.membersWithRole(q, workspaceId)).rows.filter((m) => can(m.role as Role, permission) && m.user_id !== except).map((m) => m.user_id);

  return {
    notify, holders,

    async list(a: Actor, workspaceId: string, f: { limit: number; cursor?: string | undefined; unread?: boolean | undefined }) {
      await workspaces.authorize(a.id, workspaceId, "workspace:read");
      const rows = (await repo.list(db, workspaceId, a.id, { ...f, after: decodeCursor(f.cursor, cursorSchema) })).rows;
      return { ...page(rows, f.limit, (r) => ({ createdAt: r.created_at, id: r.id })), unread: await repo.unreadCount(db, workspaceId, a.id) };
    },
    async markRead(a: Actor, workspaceId: string, id: string) {
      await workspaces.authorize(a.id, workspaceId, "workspace:read");
      if (!(await repo.markRead(db, workspaceId, a.id, id))) throw notFound("Notification");   // someone else's notification looks identical to a missing one
    },
    async markAllRead(a: Actor, workspaceId: string) {
      await workspaces.authorize(a.id, workspaceId, "workspace:read");
      return { updated: await repo.markAllRead(db, workspaceId, a.id) };
    },
    async preferences(a: Actor, workspaceId: string) {
      await workspaces.authorize(a.id, workspaceId, "workspace:read");
      const saved = new Map((await repo.allPrefs(db, workspaceId, a.id)).rows.map((p) => [p.type, p]));
      return NOTIFICATION_TYPES.map((type) => ({ type, inApp: saved.get(type)?.in_app ?? true, email: saved.get(type)?.email ?? EMAIL_DEFAULT[type] }));
    },
    async setPreferences(a: Actor, workspaceId: string, prefs: { type: NotificationType; inApp: boolean; email: boolean }[]) {
      await workspaces.authorize(a.id, workspaceId, "workspace:read");
      await db.tx(async (q) => { for (const p of prefs) await repo.setPref(q, workspaceId, a.id, p.type, p.inApp, p.email); });
      return this.preferences(a, workspaceId);
    },

    // ---- background producers & delivery (called from cron; each is idempotent and isolated)
    async produceFromPublishing() {
      return db.tx(async (q) => {
        const cursor = await repo.cursor(q, "publishing_events");
        const { maxId, events } = await repo.publishingOutcomes(q, cursor, 500, deps.producerLagS ?? 30);
        for (const e of events) {
          const what = e.title || e.preview || "your post";
          if (e.to_status === "published")
            await notify(q, { workspaceId: e.workspace_id, userIds: [e.created_by], type: "publish_succeeded", title: `Published on ${e.platform}`, body: `"${what}" is live.`, data: { jobId: e.job_id, url: e.external_url, platform: e.platform }, ref: `job:${e.job_id}:published` });
          else
            await notify(q, { workspaceId: e.workspace_id, userIds: [e.created_by], type: "publish_failed", title: `Publishing to ${e.platform} failed`, body: `"${what}": ${e.failure_message ?? e.failure_kind ?? "unknown error"}`, data: { jobId: e.job_id, platform: e.platform, kind: e.failure_kind }, ref: `job:${e.job_id}:failed:${e.id}` });
        }
        if (maxId > cursor) await repo.setCursor(q, "publishing_events", maxId);
        return events.length;
      });
    },
    async produceFromAccounts() {
      return db.tx(async (q) => {
        let n = 0;
        for (const a of (await repo.reauthAccounts(q)).rows)
          n += await notify(q, { workspaceId: a.workspace_id, userIds: await holders(q, a.workspace_id, "accounts:manage"), type: "account_reauth_required", title: `Reconnect ${a.platform}: ${a.display_name}`, body: "The connection expired or was revoked. Publishing and analytics are paused until you reconnect.", data: { accountId: a.id, platform: a.platform }, ref: `reauth:${a.id}:${new Date(a.updated_at).toISOString()}` });
        for (const a of (await repo.expiringAccounts(q)).rows)
          n += await notify(q, { workspaceId: a.workspace_id, userIds: await holders(q, a.workspace_id, "accounts:manage"), type: "account_expiring", title: `${a.platform} connection expires soon: ${a.display_name}`, body: `Reconnect before ${new Date(a.expires_at).toISOString().slice(0, 10)} to avoid failed posts.`, data: { accountId: a.id, platform: a.platform }, ref: `expiring:${a.id}:${new Date(a.expires_at).toISOString().slice(0, 10)}` });
        return n;
      });
    },
    /** Sends queued emails; failures back off exponentially and give up after 5 tries (the in-app notification always exists). */
    async deliverEmails(limit = 20) {
      const due = (await db.tx((q) => repo.dueEmails(q, limit))).rows;
      let sent = 0;
      for (const d of due) {
        const target = await repo.emailTarget(db, d.aggregate_id);
        try {
          if (target) await deps.mailer.send({ to: target.email, subject: target.title, html: `<p><strong>${esc(target.title)}</strong></p><p>${esc(target.body)}</p>${deps.appUrl ? `<p><a href="${esc(deps.appUrl)}">Open the app</a></p>` : ""}` });
          await repo.emailSent(db, d.id); sent++;
        } catch (e) {
          await repo.emailFailed(db, d.id, (e as Error).message, d.attempts + 1 >= 5);
        }
      }
      return sent;
    },
    async sweep() {
      const r = { published: 0, accounts: 0, emails: 0, errors: [] as string[] };
      const step = async (name: string, fn: () => Promise<void>) => { try { await fn(); } catch (e) { r.errors.push(`${name}: ${(e as Error).message}`); deps.log.error({ err: e, step: name }, "notification step failed"); } };
      await step("publishing", async () => { r.published = await this.produceFromPublishing(); });
      await step("accounts", async () => { r.accounts = await this.produceFromAccounts(); });
      await step("emails", async () => { r.emails = await this.deliverEmails(); });
      return r;
    },
  };
}
export type NotificationService = ReturnType<typeof createNotificationService>;
