import type { Queryable } from "../../infrastructure/database/db.js";

export interface RequestRow { id: string; post_id: string; requested_by: string; content_hash: string; required_approvals: number; status: "pending" | "approved" | "rejected" | "cancelled"; note: string | null; created_at: string; decided_at: string | null }
const COLS = "id, post_id, requested_by, content_hash, required_approvals, status, note, created_at, decided_at";

export const approvalRepository = {
  policy: async (q: Queryable, workspaceId: string) =>
    (await q.query<{ required: boolean; required_approvals: number }>("SELECT required, required_approvals FROM approval_policies WHERE workspace_id = $1", [workspaceId])).rows[0] ?? { required: false, required_approvals: 1 },
  setPolicy: (q: Queryable, workspaceId: string, required: boolean, n: number, userId: string) =>
    q.query("INSERT INTO approval_policies (workspace_id, required, required_approvals, updated_by) VALUES ($1,$2,$3,$4) ON CONFLICT (workspace_id) DO UPDATE SET required = EXCLUDED.required, required_approvals = EXCLUDED.required_approvals, updated_by = EXCLUDED.updated_by, updated_at = now()", [workspaceId, required, n, userId]),
  create: async (q: Queryable, r: { workspaceId: string; postId: string; userId: string; hash: string; required: number; note?: string | undefined }) =>
    (await q.query<RequestRow>(`INSERT INTO approval_requests (workspace_id, post_id, requested_by, content_hash, required_approvals, note) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${COLS}`, [r.workspaceId, r.postId, r.userId, r.hash, r.required, r.note ?? null])).rows[0]!,
  get: async (q: Queryable, workspaceId: string, id: string, lock = false) =>
    (await q.query<RequestRow>(`SELECT ${COLS} FROM approval_requests WHERE workspace_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`, [workspaceId, id])).rows[0] ?? null,
  list: (q: Queryable, workspaceId: string, f: { limit: number; status?: string | undefined; postId?: string | undefined; after?: { createdAt: string; id: string } | undefined }) =>
    q.query<RequestRow & { title: string | null; preview: string }>(
      `SELECT ${COLS.split(", ").map((c) => `r.${c}`).join(", ")}, p.title, left(p.body, 100) AS preview FROM approval_requests r JOIN posts p ON p.id = r.post_id AND p.workspace_id = r.workspace_id
        WHERE r.workspace_id = $1 AND ($2::text IS NULL OR r.status = $2) AND ($3::uuid IS NULL OR r.post_id = $3) AND ($4::timestamptz IS NULL OR (r.created_at, r.id) < ($4::timestamptz, $5::uuid))
        ORDER BY r.created_at DESC, r.id DESC LIMIT $6`, [workspaceId, f.status ?? null, f.postId ?? null, f.after?.createdAt ?? null, f.after?.id ?? null, f.limit + 1]),
  decisions: (q: Queryable, workspaceId: string, requestId: string) =>
    q.query<{ reviewer_id: string; decision: string; comment: string | null; created_at: string }>("SELECT reviewer_id, decision, comment, created_at FROM approvals WHERE workspace_id = $1 AND request_id = $2 ORDER BY created_at", [workspaceId, requestId]),
  addDecision: (q: Queryable, workspaceId: string, requestId: string, reviewer: string, decision: string, comment?: string) =>
    q.query("INSERT INTO approvals (request_id, workspace_id, reviewer_id, decision, comment) VALUES ($1,$2,$3,$4,$5)", [requestId, workspaceId, reviewer, decision, comment ?? null]),
  setStatus: (q: Queryable, workspaceId: string, id: string, status: string) =>
    q.query("UPDATE approval_requests SET status = $3, decided_at = CASE WHEN $3 = 'pending' THEN NULL ELSE now() END WHERE workspace_id = $1 AND id = $2", [workspaceId, id, status]),
  approvedCount: async (q: Queryable, workspaceId: string, requestId: string) =>
    (await q.query<{ n: number }>("SELECT count(*)::int AS n FROM approvals WHERE workspace_id = $1 AND request_id = $2 AND decision = 'approved'", [workspaceId, requestId])).rows[0]!.n,
  /** Latest approved request for a post: the gate compares its content hash with the post as it is NOW. */
  latestApproved: async (q: Queryable, workspaceId: string, postId: string) =>
    (await q.query<{ id: string; content_hash: string }>("SELECT id, content_hash FROM approval_requests WHERE workspace_id = $1 AND post_id = $2 AND status = 'approved' ORDER BY decided_at DESC LIMIT 1", [workspaceId, postId])).rows[0] ?? null,
};
