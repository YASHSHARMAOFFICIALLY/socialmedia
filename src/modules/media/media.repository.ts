import type { Queryable } from "../../infrastructure/database/db.js";

export interface MediaRow {
  id: string; workspace_id: string; kind: "image" | "video"; storage_key: string; filename: string; mime_type: string; size_bytes: string;
  width: number | null; height: number | null; duration_ms: number | null; status: "pending_upload" | "uploaded" | "ready" | "failed" | "deleted"; created_at: string;
}
const COLS = "id, workspace_id, kind, storage_key, filename, mime_type, size_bytes::text, width, height, duration_ms, status, created_at";
const PUBLIC = "id, kind, filename, mime_type, size_bytes::text, width, height, duration_ms, status, created_at";

export const mediaRepository = {
  create: async (q: Queryable, m: { id: string; workspaceId: string; kind: string; key: string; filename: string; mime: string; size: number; userId: string; derivedFrom?: string; derivation?: object; status?: string; width?: number | null; height?: number | null; durationMs?: number | null }) =>
    (await q.query<MediaRow>(`INSERT INTO media_assets (id, workspace_id, kind, storage_key, filename, mime_type, size_bytes, created_by, derived_from, derivation, status, width, height, duration_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,'pending_upload'),$12,$13,$14) RETURNING ${COLS}`,
      [m.id, m.workspaceId, m.kind, m.key, m.filename, m.mime, m.size, m.userId, m.derivedFrom ?? null, m.derivation ? JSON.stringify(m.derivation) : null, m.status ?? null, m.width ?? null, m.height ?? null, m.durationMs ?? null])).rows[0]!,
  get: async (q: Queryable, workspaceId: string, id: string, lock = false) =>
    (await q.query<MediaRow>(`SELECT ${COLS} FROM media_assets WHERE workspace_id = $1 AND id = $2 AND status <> 'deleted'${lock ? " FOR UPDATE" : ""}`, [workspaceId, id])).rows[0] ?? null,
  /** Library listing with usage counts (one query, no N+1). */
  list: (q: Queryable, workspaceId: string, f: { limit: number; kind?: string | undefined; status?: string | undefined; q?: string | undefined; unused?: boolean | undefined; after?: { createdAt: string; id: string } | undefined }) =>
    q.query<Omit<MediaRow, "storage_key" | "workspace_id"> & { usage_count: number }>(
      `SELECT ${PUBLIC.split(", ").map((c) => `m.${c}`).join(", ")}, (SELECT count(*)::int FROM post_media pm WHERE pm.media_id = m.id AND pm.workspace_id = m.workspace_id) AS usage_count
         FROM media_assets m WHERE m.workspace_id = $1 AND m.status <> 'deleted'
          AND ($2::text IS NULL OR m.kind = $2) AND ($3::text IS NULL OR m.status = $3)
          AND ($4::text IS NULL OR m.filename ILIKE '%' || $4 || '%' ESCAPE '\\')
          AND ($5::boolean IS NULL OR ($5 = NOT EXISTS (SELECT 1 FROM post_media pm WHERE pm.media_id = m.id AND pm.workspace_id = m.workspace_id)))
          AND ($6::timestamptz IS NULL OR (m.created_at, m.id) < ($6::timestamptz, $7::uuid))
        ORDER BY m.created_at DESC, m.id DESC LIMIT $8`,
      [workspaceId, f.kind ?? null, f.status ?? null, f.q ? f.q.replace(/[\\%_]/g, "\\$&") : null, f.unused ?? null, f.after?.createdAt ?? null, f.after?.id ?? null, f.limit + 1]),
  usageCount: async (q: Queryable, workspaceId: string, id: string) =>
    (await q.query<{ n: number }>("SELECT count(*)::int AS n FROM post_media WHERE workspace_id = $1 AND media_id = $2", [workspaceId, id])).rows[0]!.n,
  setReady: (q: Queryable, workspaceId: string, id: string, dims: { width: number; height: number } | null, durationMs: number | null = null) =>
    q.query("UPDATE media_assets SET status = 'ready', width = $3, height = $4, duration_ms = $5 WHERE workspace_id = $1 AND id = $2", [workspaceId, id, dims?.width ?? null, dims?.height ?? null, durationMs]),
  setFailed: (q: Queryable, workspaceId: string, id: string) => q.query("UPDATE media_assets SET status = 'failed' WHERE workspace_id = $1 AND id = $2", [workspaceId, id]),
  remove: (q: Queryable, workspaceId: string, id: string) => q.query("DELETE FROM media_assets WHERE workspace_id = $1 AND id = $2", [workspaceId, id]),
  staleUploads: (q: Queryable, olderThanHours: number, limit: number) =>
    q.query<{ id: string; workspace_id: string; storage_key: string }>(
      `SELECT m.id, m.workspace_id, m.storage_key FROM media_assets m
        WHERE m.status IN ('pending_upload','failed') AND m.created_at < now() - make_interval(hours => $1)
          AND NOT EXISTS (SELECT 1 FROM post_media pm WHERE pm.media_id = m.id) ORDER BY m.created_at LIMIT $2`, [olderThanHours, limit]),
};
