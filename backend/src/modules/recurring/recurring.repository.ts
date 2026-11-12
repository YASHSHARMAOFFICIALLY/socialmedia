import type { Queryable } from "../../infrastructure/database/db.js";

export interface SeriesRow {
  id: string; workspace_id: string; template_post_id: string; frequency: "daily" | "weekly" | "monthly"; interval_n: number; start_local: string; timezone: string;
  max_count: number | null; until_date: string | null; account_ids: string[] | null; status: "active" | "paused" | "ended"; next_no: number; next_at: string | null; created_by: string; created_at: string;
}
const COLS = "id, workspace_id, template_post_id, frequency, interval_n, start_local, timezone, max_count, until_date::text, account_ids, status, next_no, next_at, created_by, created_at";

export const recurringRepository = {
  create: async (q: Queryable, s: { workspaceId: string; postId: string; frequency: string; interval: number; startLocal: string; timezone: string; count?: number | undefined; untilDate?: string | undefined; accountIds?: string[] | undefined; nextAt: Date | null; userId: string }) =>
    (await q.query<SeriesRow>(
      `INSERT INTO recurring_series (workspace_id, template_post_id, frequency, interval_n, start_local, timezone, max_count, until_date, account_ids, next_at, created_by, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, CASE WHEN $10::timestamptz IS NULL THEN 'ended' ELSE 'active' END) RETURNING ${COLS}`,
      [s.workspaceId, s.postId, s.frequency, s.interval, s.startLocal, s.timezone, s.count ?? null, s.untilDate ?? null, s.accountIds ?? null, s.nextAt?.toISOString() ?? null, s.userId])).rows[0]!,
  get: async (q: Queryable, ws: string, id: string, lock = false) => (await q.query<SeriesRow>(`SELECT ${COLS} FROM recurring_series WHERE workspace_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`, [ws, id])).rows[0] ?? null,
  list: (q: Queryable, ws: string, f: { limit: number; status?: string | undefined; after?: { createdAt: string; id: string } | undefined }) =>
    q.query<SeriesRow>(`SELECT ${COLS} FROM recurring_series WHERE workspace_id = $1 AND ($2::text IS NULL OR status = $2) AND ($3::timestamptz IS NULL OR (created_at, id) < ($3::timestamptz, $4::uuid)) ORDER BY created_at DESC, id DESC LIMIT $5`, [ws, f.status ?? null, f.after?.createdAt ?? null, f.after?.id ?? null, f.limit + 1]),
  setStatus: (q: Queryable, ws: string, id: string, status: string) => q.query("UPDATE recurring_series SET status = $3 WHERE workspace_id = $1 AND id = $2 AND status <> 'ended'", [ws, id, status]),
  occurrences: (q: Queryable, ws: string, id: string) => q.query<{ occurrence_no: number; scheduled_at: string; post_id: string | null; status: string; error: string | null }>("SELECT occurrence_no, scheduled_at, post_id, status, error FROM series_occurrences WHERE workspace_id = $1 AND series_id = $2 ORDER BY occurrence_no", [ws, id]),
  /** Active series whose next occurrence is inside the look-ahead window. */
  due: (q: Queryable, lookaheadHours: number, limit: number) => q.query<SeriesRow>(`SELECT ${COLS} FROM recurring_series WHERE status = 'active' AND next_at <= now() + make_interval(hours => $1) ORDER BY next_at LIMIT $2 FOR UPDATE SKIP LOCKED`, [lookaheadHours, limit]),
  claimOccurrence: async (q: Queryable, s: SeriesRow, at: Date) =>
    (await q.query("INSERT INTO series_occurrences (series_id, workspace_id, occurrence_no, scheduled_at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [s.id, s.workspace_id, s.next_no, at.toISOString()])).rowCount === 1,
  advance: (q: Queryable, id: string, nextNo: number, nextAt: Date | null) => q.query("UPDATE recurring_series SET next_no = $2, next_at = $3, status = CASE WHEN $3::timestamptz IS NULL THEN 'ended' ELSE status END WHERE id = $1", [id, nextNo, nextAt?.toISOString() ?? null]),
  /** Claims pending occurrences (or ones whose worker died > 5 min ago). The claim is a single UPDATE, so concurrent sweeps never process the same one. */
  claimPending: (q: Queryable, limit: number) =>
    q.query<{ series_id: string; workspace_id: string; occurrence_no: number; scheduled_at: string; post_id: string | null }>(
      `UPDATE series_occurrences SET status = 'processing', claimed_at = now() WHERE (series_id, occurrence_no) IN (
         SELECT series_id, occurrence_no FROM series_occurrences WHERE status = 'pending' OR (status = 'processing' AND claimed_at < now() - interval '5 minutes')
          ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED) RETURNING series_id, workspace_id, occurrence_no, scheduled_at, post_id`, [limit]),
  setOccurrencePost: (q: Queryable, id: string, no: number, postId: string) => q.query("UPDATE series_occurrences SET post_id = $3 WHERE series_id = $1 AND occurrence_no = $2", [id, no, postId]),
  finishOccurrence: (q: Queryable, id: string, no: number, status: string, error?: string) => q.query("UPDATE series_occurrences SET status = $3, error = $4 WHERE series_id = $1 AND occurrence_no = $2", [id, no, status, error?.slice(0, 500) ?? null]),
};
