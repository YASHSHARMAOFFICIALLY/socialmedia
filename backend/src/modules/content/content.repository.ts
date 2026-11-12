import type { Queryable } from "../../infrastructure/database/db.js";
import type { MediaInput } from "../../integrations/core/rules.js";

export interface PostRow { id: string; workspace_id: string; created_by: string; title: string | null; body: string; hashtags: string[]; labels: string[]; status: "draft" | "submitted"; created_at: string; updated_at: string }
export interface VariantRow { id: string; post_id: string; social_account_id: string; platform: string; caption: string | null; title: string | null; description: string | null; hashtags: string[] | null; metadata: Record<string, unknown>; account_name: string; account_status: string }
export interface PostMediaRow { variant_id: string | null; media_id: string; role: "media" | "thumbnail"; position: number; kind: "image" | "video"; mime_type: string; size_bytes: string; width: number | null; height: number | null; duration_ms: number | null; status: string; filename: string; storage_key: string }

const POST_COLS = "id, workspace_id, created_by, title, body, hashtags, labels, status, created_at, updated_at";

export const contentRepository = {
  createPost: async (q: Queryable, p: { workspaceId: string; userId: string; title?: string | undefined; body: string; hashtags: string[]; labels: string[] }) =>
    (await q.query<PostRow>(`INSERT INTO posts (workspace_id, created_by, title, body, hashtags, labels) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${POST_COLS}`,
      [p.workspaceId, p.userId, p.title ?? null, p.body, p.hashtags, p.labels])).rows[0]!,
  getPost: async (q: Queryable, workspaceId: string, postId: string, lock = false) =>
    (await q.query<PostRow>(`SELECT ${POST_COLS} FROM posts WHERE workspace_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`, [workspaceId, postId])).rows[0] ?? null,
  updatePost: async (q: Queryable, workspaceId: string, postId: string, patch: { title?: string | null; body?: string; hashtags?: string[]; labels?: string[] }) =>
    (await q.query<PostRow>(
      `UPDATE posts SET title = CASE WHEN $3 THEN $4 ELSE title END, body = COALESCE($5, body), hashtags = COALESCE($6, hashtags), labels = COALESCE($7, labels)
        WHERE workspace_id = $1 AND id = $2 RETURNING ${POST_COLS}`,
      [workspaceId, postId, "title" in patch, patch.title ?? null, patch.body ?? null, patch.hashtags ?? null, patch.labels ?? null])).rows[0]!,
  deletePost: async (q: Queryable, workspaceId: string, postId: string) =>
    (await q.query("DELETE FROM posts WHERE workspace_id = $1 AND id = $2 AND status = 'draft'", [workspaceId, postId])).rowCount,
  list: (q: Queryable, workspaceId: string, f: { limit: number; status?: string | undefined; label?: string | undefined; q?: string | undefined; after?: { createdAt: string; id: string } | undefined }) =>
    q.query<PostRow>(
      `SELECT ${POST_COLS} FROM posts WHERE workspace_id = $1
         AND ($2::text IS NULL OR status = $2) AND ($3::text IS NULL OR $3 = ANY(labels))
         AND ($4::text IS NULL OR title ILIKE '%' || $4 || '%' ESCAPE '\\' OR body ILIKE '%' || $4 || '%' ESCAPE '\\')
         AND ($5::timestamptz IS NULL OR (created_at, id) < ($5::timestamptz, $6::uuid))
       ORDER BY created_at DESC, id DESC LIMIT $7`,
      [workspaceId, f.status ?? null, f.label ?? null, f.q ? f.q.replace(/[\\%_]/g, "\\$&") : null, f.after?.createdAt ?? null, f.after?.id ?? null, f.limit + 1]),

  accountsByIds: async (q: Queryable, workspaceId: string, ids: string[]) =>
    (await q.query<{ id: string; platform: string; status: string }>("SELECT id, platform, status FROM social_accounts WHERE workspace_id = $1 AND id = ANY($2::uuid[])", [workspaceId, ids])).rows,
  mediaByIds: async (q: Queryable, workspaceId: string, ids: string[]) =>
    (await q.query<{ id: string }>("SELECT id FROM media_assets WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND status = 'ready'", [workspaceId, ids])).rows,   // only verified (confirmed) assets can be attached

  upsertVariant: async (q: Queryable, v: { workspaceId: string; postId: string; accountId: string; platform: string; caption?: string | null | undefined; title?: string | null | undefined; description?: string | null | undefined; hashtags?: string[] | null | undefined; metadata?: Record<string, unknown> | undefined }) =>
    (await q.query<{ id: string }>(
      `INSERT INTO post_variants (workspace_id, post_id, social_account_id, platform, caption, title, description, hashtags, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (post_id, social_account_id) DO UPDATE SET caption = EXCLUDED.caption, title = EXCLUDED.title, description = EXCLUDED.description,
         hashtags = EXCLUDED.hashtags, metadata = EXCLUDED.metadata
       RETURNING id`,
      [v.workspaceId, v.postId, v.accountId, v.platform, v.caption ?? null, v.title ?? null, v.description ?? null, v.hashtags ?? null, JSON.stringify(v.metadata ?? {})])).rows[0]!.id,
  deleteVariant: async (q: Queryable, workspaceId: string, postId: string, accountId: string) =>
    (await q.query("DELETE FROM post_variants WHERE workspace_id = $1 AND post_id = $2 AND social_account_id = $3", [workspaceId, postId, accountId])).rowCount,
  replaceMedia: async (q: Queryable, workspaceId: string, postId: string, variantId: string | null, media: { mediaId: string; role: string }[]) => {
    await q.query("DELETE FROM post_media WHERE workspace_id = $1 AND post_id = $2 AND variant_id IS NOT DISTINCT FROM $3", [workspaceId, postId, variantId]);
    for (const [i, m] of media.entries())
      await q.query("INSERT INTO post_media (workspace_id, post_id, variant_id, media_id, role, position) VALUES ($1,$2,$3,$4,$5,$6)", [workspaceId, postId, variantId, m.mediaId, m.role, i]);
  },
  // Two set-based queries load everything (no per-variant lookups).
  variants: (q: Queryable, workspaceId: string, postId: string) =>
    q.query<VariantRow>(
      `SELECT v.id, v.post_id, v.social_account_id, v.platform, v.caption, v.title, v.description, v.hashtags, v.metadata, a.display_name AS account_name, a.status AS account_status
         FROM post_variants v JOIN social_accounts a ON a.id = v.social_account_id AND a.workspace_id = v.workspace_id
        WHERE v.workspace_id = $1 AND v.post_id = $2 ORDER BY v.created_at, v.id`, [workspaceId, postId]),
  media: (q: Queryable, workspaceId: string, postId: string) =>
    q.query<PostMediaRow>(
      `SELECT pm.variant_id, pm.media_id, pm.role, pm.position, m.kind, m.mime_type, m.size_bytes::text, m.width, m.height, m.duration_ms, m.status, m.filename, m.storage_key
         FROM post_media pm JOIN media_assets m ON m.id = pm.media_id AND m.workspace_id = pm.workspace_id
        WHERE pm.workspace_id = $1 AND pm.post_id = $2 ORDER BY pm.position`, [workspaceId, postId]),
};

export const toMediaInput = (m: PostMediaRow): MediaInput => ({ kind: m.kind, role: m.role, mimeType: m.mime_type, sizeBytes: Number(m.size_bytes), width: m.width, height: m.height, durationMs: m.duration_ms });
