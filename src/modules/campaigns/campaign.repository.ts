import type { Queryable } from "../../infrastructure/database/db.js";

export interface CampaignRow { id: string; name: string; description: string | null; start_date: string | null; end_date: string | null; status: string; created_at: string; updated_at: string }
const COLS = "id, name, description, start_date::text, end_date::text, status, created_at, updated_at";

export const campaignRepository = {
  create: async (q: Queryable, c: { workspaceId: string; userId: string; name: string; description?: string | undefined; startDate?: string | undefined; endDate?: string | undefined }) =>
    (await q.query<CampaignRow>(`INSERT INTO campaigns (workspace_id, created_by, name, description, start_date, end_date) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${COLS}`, [c.workspaceId, c.userId, c.name, c.description ?? null, c.startDate ?? null, c.endDate ?? null])).rows[0]!,
  get: async (q: Queryable, workspaceId: string, id: string) =>
    (await q.query<CampaignRow>(`SELECT ${COLS} FROM campaigns WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rows[0] ?? null,
  list: (q: Queryable, workspaceId: string, f: { limit: number; status?: string | undefined; after?: { createdAt: string; id: string } | undefined }) =>
    q.query<CampaignRow & { post_count: number }>(
      `SELECT ${COLS.split(", ").map((c) => `c.${c.replace("::text", "")}${c.includes("::text") ? "::text" : ""}`).join(", ")}, (SELECT count(*)::int FROM campaign_posts cp WHERE cp.campaign_id = c.id) AS post_count
         FROM campaigns c WHERE c.workspace_id = $1 AND ($2::text IS NULL OR c.status = $2) AND ($3::timestamptz IS NULL OR (c.created_at, c.id) < ($3::timestamptz, $4::uuid))
        ORDER BY c.created_at DESC, c.id DESC LIMIT $5`, [workspaceId, f.status ?? null, f.after?.createdAt ?? null, f.after?.id ?? null, f.limit + 1]),
  update: async (q: Queryable, workspaceId: string, id: string, p: Record<string, unknown>, set: Set<string>) =>
    (await q.query<CampaignRow>(
      `UPDATE campaigns SET name = CASE WHEN $3 THEN $4 ELSE name END, description = CASE WHEN $5 THEN $6 ELSE description END,
              start_date = CASE WHEN $7 THEN $8::date ELSE start_date END, end_date = CASE WHEN $9 THEN $10::date ELSE end_date END, status = CASE WHEN $11 THEN $12 ELSE status END
        WHERE workspace_id = $1 AND id = $2 RETURNING ${COLS}`,
      [workspaceId, id, set.has("name"), p.name ?? null, set.has("description"), p.description ?? null, set.has("startDate"), p.startDate ?? null, set.has("endDate"), p.endDate ?? null, set.has("status"), p.status ?? null])).rows[0] ?? null,
  existingPosts: async (q: Queryable, workspaceId: string, ids: string[]) =>
    (await q.query<{ id: string; campaign_id: string | null }>("SELECT p.id, cp.campaign_id FROM posts p LEFT JOIN campaign_posts cp ON cp.post_id = p.id WHERE p.workspace_id = $1 AND p.id = ANY($2::uuid[])", [workspaceId, ids])).rows,
  addPost: (q: Queryable, workspaceId: string, campaignId: string, postId: string) =>
    q.query("INSERT INTO campaign_posts (campaign_id, post_id, workspace_id) VALUES ($1,$2,$3) ON CONFLICT (post_id) DO UPDATE SET campaign_id = EXCLUDED.campaign_id, added_at = now()", [campaignId, postId, workspaceId]),
  removePost: async (q: Queryable, workspaceId: string, campaignId: string, postId: string) =>
    (await q.query("DELETE FROM campaign_posts WHERE workspace_id = $1 AND campaign_id = $2 AND post_id = $3", [workspaceId, campaignId, postId])).rowCount,
  posts: (q: Queryable, workspaceId: string, campaignId: string) =>
    q.query<{ id: string; title: string | null; preview: string; status: string; added_at: string }>(
      `SELECT p.id, p.title, left(p.body, 140) AS preview, p.status, cp.added_at FROM campaign_posts cp JOIN posts p ON p.id = cp.post_id AND p.workspace_id = cp.workspace_id
        WHERE cp.workspace_id = $1 AND cp.campaign_id = $2 ORDER BY cp.added_at, p.id`, [workspaceId, campaignId]),
  publishingStatus: (q: Queryable, workspaceId: string, campaignId: string) =>
    q.query<{ platform: string; status: string; n: number }>(
      `SELECT j.platform, j.status, count(*)::int AS n FROM publishing_jobs j JOIN campaign_posts cp ON cp.post_id = j.post_id AND cp.workspace_id = j.workspace_id
        WHERE j.workspace_id = $1 AND cp.campaign_id = $2 GROUP BY j.platform, j.status ORDER BY j.platform, j.status`, [workspaceId, campaignId]),
};
