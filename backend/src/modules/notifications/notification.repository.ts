import type { Queryable } from "../../infrastructure/database/db.js";

export interface NotificationRow { id: string; type: string; title: string; body: string; data: unknown; read_at: string | null; created_at: string }

export const notificationRepository = {
  prefs: (q: Queryable, workspaceId: string, userIds: string[], type: string) =>
    q.query<{ user_id: string; in_app: boolean; email: boolean }>("SELECT user_id, in_app, email FROM notification_preferences WHERE workspace_id = $1 AND user_id = ANY($2::text[]) AND type = $3", [workspaceId, userIds, type]),
  insert: async (q: Queryable, n: { workspaceId: string; userId: string; type: string; title: string; body: string; data: object; ref: string }) =>
    (await q.query<{ id: string }>(
      `INSERT INTO notifications (workspace_id, user_id, type, title, body, data, ref) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (user_id, type, ref) DO NOTHING RETURNING id`,
      [n.workspaceId, n.userId, n.type, n.title, n.body, JSON.stringify(n.data), n.ref])).rows[0]?.id ?? null,
  queueEmail: (q: Queryable, workspaceId: string, notificationId: string) =>
    q.query("INSERT INTO outbox_events (workspace_id, type, aggregate_id) VALUES ($1,'notification_email',$2)", [workspaceId, notificationId]),
  list: (q: Queryable, workspaceId: string, userId: string, f: { limit: number; unread?: boolean | undefined; after?: { createdAt: string; id: string } | undefined }) =>
    q.query<NotificationRow>(
      `SELECT id, type, title, body, data, read_at, created_at FROM notifications WHERE workspace_id = $1 AND user_id = $2 AND ($3::boolean IS NOT TRUE OR read_at IS NULL)
          AND ($4::timestamptz IS NULL OR (created_at, id) < ($4::timestamptz, $5::uuid)) ORDER BY created_at DESC, id DESC LIMIT $6`,
      [workspaceId, userId, f.unread ?? null, f.after?.createdAt ?? null, f.after?.id ?? null, f.limit + 1]),
  unreadCount: async (q: Queryable, workspaceId: string, userId: string) =>
    (await q.query<{ n: number }>("SELECT count(*)::int AS n FROM notifications WHERE workspace_id = $1 AND user_id = $2 AND read_at IS NULL", [workspaceId, userId])).rows[0]!.n,
  markRead: async (q: Queryable, workspaceId: string, userId: string, id: string) =>
    (await q.query("UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE workspace_id = $1 AND user_id = $2 AND id = $3", [workspaceId, userId, id])).rowCount,
  markAllRead: async (q: Queryable, workspaceId: string, userId: string) =>
    (await q.query("UPDATE notifications SET read_at = now() WHERE workspace_id = $1 AND user_id = $2 AND read_at IS NULL", [workspaceId, userId])).rowCount,
  allPrefs: (q: Queryable, workspaceId: string, userId: string) =>
    q.query<{ type: string; in_app: boolean; email: boolean }>("SELECT type, in_app, email FROM notification_preferences WHERE workspace_id = $1 AND user_id = $2", [workspaceId, userId]),
  setPref: (q: Queryable, workspaceId: string, userId: string, type: string, inApp: boolean, email: boolean) =>
    q.query(
      "INSERT INTO notification_preferences (workspace_id, user_id, type, in_app, email) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (workspace_id, user_id, type) DO UPDATE SET in_app = EXCLUDED.in_app, email = EXCLUDED.email",
      [workspaceId, userId, type, inApp, email]),
  membersWithRole: (q: Queryable, workspaceId: string) => q.query<{ user_id: string; role: string }>("SELECT user_id, role FROM workspace_members WHERE workspace_id = $1", [workspaceId]),

  // ---- producers (cursor based: they read domain events and never run inside publishing transactions)
  cursor: async (q: Queryable, name: string) => Number((await q.query<{ last_id: string }>("SELECT last_id::text FROM notification_cursors WHERE name = $1", [name])).rows[0]?.last_id ?? 0),
  setCursor: (q: Queryable, name: string, id: number) => q.query("INSERT INTO notification_cursors (name, last_id) VALUES ($1,$2) ON CONFLICT (name) DO UPDATE SET last_id = EXCLUDED.last_id", [name, id]),
  publishingOutcomes: async (q: Queryable, after: number, window: number, lagS: number) => {
    const ids = (await q.query<{ id: string }>("SELECT id::text FROM publishing_events WHERE id > $1 AND created_at <= now() - make_interval(secs => $3) ORDER BY id LIMIT $2", [after, window, lagS])).rows.map((r) => Number(r.id));
    if (!ids.length) return { maxId: after, events: [] };
    const events = (await q.query<{ id: string; job_id: string; workspace_id: string; to_status: string; created_by: string; platform: string; external_url: string | null; failure_kind: string | null; failure_message: string | null; title: string | null; preview: string }>(
      `SELECT e.id::text, e.job_id, e.workspace_id, e.to_status, j.created_by, j.platform, j.external_url, j.failure_kind, j.failure_message, p.title, left(p.body, 80) AS preview
         FROM publishing_events e JOIN publishing_jobs j ON j.id = e.job_id AND j.workspace_id = e.workspace_id JOIN posts p ON p.id = j.post_id AND p.workspace_id = j.workspace_id
        WHERE e.id BETWEEN $1 AND $2 AND e.to_status IN ('published','failed')
        ORDER BY e.id`, [ids[0], ids.at(-1)])).rows;
    return { maxId: ids.at(-1)!, events };
  },
  reauthAccounts: (q: Queryable) => q.query<{ id: string; workspace_id: string; display_name: string; platform: string; updated_at: string }>("SELECT id, workspace_id, display_name, platform, updated_at FROM social_accounts WHERE status = 'needs_reauth'"),
  expiringAccounts: (q: Queryable) =>
    q.query<{ id: string; workspace_id: string; display_name: string; platform: string; expires_at: string }>(
      `SELECT a.id, a.workspace_id, a.display_name, a.platform, c.expires_at FROM social_accounts a JOIN oauth_credentials c ON c.social_account_id = a.id AND c.workspace_id = a.workspace_id
        WHERE a.status = 'active' AND c.refresh_token_enc IS NULL AND c.expires_at IS NOT NULL AND c.expires_at > now() AND c.expires_at < now() + interval '3 days'`),

  // ---- email outbox
  /** Claims due emails with a 5-minute visibility window (a crashed run simply makes them due again). */
  dueEmails: (q: Queryable, limit: number) =>
    q.query<{ id: string; aggregate_id: string; attempts: number }>(
      `UPDATE outbox_events SET available_at = now() + interval '5 minutes' WHERE id IN (
         SELECT id FROM outbox_events WHERE type = 'notification_email' AND dispatched_at IS NULL AND available_at <= now() ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED)
       RETURNING id, aggregate_id, attempts`, [limit]),
  emailTarget: async (q: Queryable, notificationId: string) =>
    (await q.query<{ title: string; body: string; email: string; type: string }>("SELECT n.title, n.body, n.type, u.email FROM notifications n JOIN \"user\" u ON u.id = n.user_id WHERE n.id = $1", [notificationId])).rows[0] ?? null,
  emailSent: (q: Queryable, id: string) => q.query("UPDATE outbox_events SET dispatched_at = now(), attempts = attempts + 1 WHERE id = $1", [id]),
  emailFailed: (q: Queryable, id: string, error: string, giveUp: boolean) =>
    q.query("UPDATE outbox_events SET attempts = attempts + 1, last_error = $2, dispatched_at = CASE WHEN $3 THEN now() ELSE NULL END, available_at = now() + make_interval(mins => LEAST(60, power(2, attempts + 1)::int)) WHERE id = $1", [id, error.slice(0, 300), giveUp]),
};
