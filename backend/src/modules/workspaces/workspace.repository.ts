import type { Queryable } from "../../infrastructure/database/db.js";
import type { Role } from "./permissions.js";

export interface WorkspaceRow { id: string; name: string; kind: string; created_at: string; updated_at: string }
export interface MemberRow { user_id: string; email: string; name: string; role: Role; created_at: string }
export interface InvitationRow { id: string; workspace_id: string; email: string; role: Role; expires_at: string; accepted_at: string | null; revoked_at: string | null; created_at: string }

const WS = "w.id, w.name, w.kind, w.created_at, w.updated_at";

// Every query that touches tenant data takes workspace_id and filters on it. No query looks a child row up by id alone.
export const workspaceRepository = {
  create: async (q: Queryable, name: string, kind: string, userId: string) => {
    const ws = (await q.query<WorkspaceRow>("INSERT INTO workspaces (name, kind, created_by) VALUES ($1,$2,$3) RETURNING id, name, kind, created_at, updated_at", [name, kind, userId])).rows[0]!;
    await q.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'owner')", [ws.id, userId]);
    return ws;
  },
  getMemberRole: async (q: Queryable, workspaceId: string, userId: string) =>
    (await q.query<{ role: Role }>("SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2", [workspaceId, userId])).rows[0]?.role ?? null,
  listForUser: (q: Queryable, userId: string, limit: number, after?: { createdAt: string; id: string }) =>
    q.query<WorkspaceRow & { role: Role }>(
      `SELECT ${WS}, m.role FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id
        WHERE m.user_id = $1 AND ($2::timestamptz IS NULL OR (w.created_at, w.id) > ($2::timestamptz, $3::uuid))
        ORDER BY w.created_at, w.id LIMIT $4`,
      [userId, after?.createdAt ?? null, after?.id ?? null, limit + 1],
    ),
  get: async (q: Queryable, workspaceId: string) =>
    (await q.query<WorkspaceRow>("SELECT id, name, kind, created_at, updated_at FROM workspaces w WHERE id = $1", [workspaceId])).rows[0] ?? null,
  update: async (q: Queryable, workspaceId: string, patch: { name?: string | undefined; kind?: string | undefined }) =>
    (await q.query<WorkspaceRow>(
      "UPDATE workspaces SET name = COALESCE($2, name), kind = COALESCE($3, kind) WHERE id = $1 RETURNING id, name, kind, created_at, updated_at",
      [workspaceId, patch.name ?? null, patch.kind ?? null],
    )).rows[0] ?? null,
  listMembers: (q: Queryable, workspaceId: string) =>
    q.query<MemberRow>(
      `SELECT m.user_id, u.email, u.name, m.role, m.created_at FROM workspace_members m JOIN "user" u ON u.id = m.user_id
        WHERE m.workspace_id = $1 ORDER BY m.created_at, m.user_id`, [workspaceId]),
  // FOR UPDATE serializes concurrent role changes so the "last owner" check can't be raced.
  lockOwners: async (q: Queryable, workspaceId: string) =>
    (await q.query<{ user_id: string }>("SELECT user_id FROM workspace_members WHERE workspace_id = $1 AND role = 'owner' FOR UPDATE", [workspaceId])).rows.map((r) => r.user_id),
  setRole: async (q: Queryable, workspaceId: string, userId: string, role: Role) =>
    (await q.query("UPDATE workspace_members SET role = $3 WHERE workspace_id = $1 AND user_id = $2", [workspaceId, userId, role])).rowCount,
  removeMember: async (q: Queryable, workspaceId: string, userId: string) =>
    (await q.query("DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2", [workspaceId, userId])).rowCount,
  addMember: (q: Queryable, workspaceId: string, userId: string, role: Role) =>
    q.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [workspaceId, userId, role]),

  createInvitation: async (q: Queryable, i: { workspaceId: string; email: string; role: Role; tokenHash: string; invitedBy: string; expiresAt: Date }) =>
    (await q.query<InvitationRow>(
      `INSERT INTO workspace_invitations (workspace_id, email, role, token_hash, invited_by, expires_at) VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, workspace_id, email, role, expires_at, accepted_at, revoked_at, created_at`,
      [i.workspaceId, i.email, i.role, i.tokenHash, i.invitedBy, i.expiresAt.toISOString()],
    )).rows[0]!,
  listInvitations: (q: Queryable, workspaceId: string) =>
    q.query<InvitationRow>(
      `SELECT id, workspace_id, email, role, expires_at, accepted_at, revoked_at, created_at FROM workspace_invitations
        WHERE workspace_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL ORDER BY created_at DESC`, [workspaceId]),
  revokeInvitation: async (q: Queryable, workspaceId: string, id: string) =>
    (await q.query("UPDATE workspace_invitations SET revoked_at = now() WHERE id = $1 AND workspace_id = $2 AND accepted_at IS NULL AND revoked_at IS NULL", [id, workspaceId])).rowCount,
  // Atomic single-use consume: only one concurrent accept can win.
  consumeInvitation: async (q: Queryable, tokenHash: string) =>
    (await q.query<InvitationRow>(
      `UPDATE workspace_invitations SET accepted_at = now()
        WHERE token_hash = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
        RETURNING id, workspace_id, email, role, expires_at, accepted_at, revoked_at, created_at`, [tokenHash])).rows[0] ?? null,
};
