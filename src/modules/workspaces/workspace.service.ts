import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { Db, Queryable } from "../../infrastructure/database/db.js";
import type { Mailer } from "../../infrastructure/email/resend.js";
import { AppError, badRequest, forbidden, notFound } from "../../shared/errors/errors.js";
import { decodeCursor, page } from "../../shared/utils/pagination.js";
import { auditRepository } from "../audit/audit.repository.js";
import { can, canManageRole, type Permission, type Role } from "./permissions.js";
import { workspaceRepository as repo } from "./workspace.repository.js";

const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const cursorSchema = z.object({ createdAt: z.string(), id: z.string() });

export interface Actor { id: string; email: string; requestId?: string }

export function createWorkspaceService(db: Db, mailer: Mailer, appUrl: string) {
  /**
   * Single gate for tenant access. Non-members get 404 (never confirm another tenant's workspace exists);
   * members lacking the permission get 403.
   */
  async function authorize(userId: string, workspaceId: string, permission: Permission, q: Queryable = db): Promise<Role> {
    const role = await repo.getMemberRole(q, workspaceId, userId);
    if (!role) throw notFound("Workspace");
    if (!can(role, permission)) throw forbidden();
    return role;
  }
  const audit = (a: Actor, workspaceId: string, action: string, extra: { entityType?: string; entityId?: string; metadata?: Record<string, unknown> } = {}, q: Queryable = db) =>
    auditRepository.record(q, { workspaceId, actorId: a.id, action, ...(a.requestId ? { requestId: a.requestId } : {}), ...extra });

  return {
    authorize,

    async create(a: Actor, input: { name: string; kind: string }) {
      return db.tx(async (q) => {
        const ws = await repo.create(q, input.name, input.kind, a.id);
        await audit(a, ws.id, "workspace.created", { entityType: "workspace", entityId: ws.id }, q);
        return ws;
      });
    },

    async list(a: Actor, limit: number, cursor?: string) {
      const after = decodeCursor(cursor, cursorSchema);
      const rows = (await repo.listForUser(db, a.id, limit, after)).rows;
      return page(rows, limit, (r) => ({ createdAt: r.created_at, id: r.id }));
    },

    async get(a: Actor, workspaceId: string) {
      const role = await authorize(a.id, workspaceId, "workspace:read");
      return { ...(await repo.get(db, workspaceId))!, role };
    },

    async update(a: Actor, workspaceId: string, patch: { name?: string | undefined; kind?: string | undefined }) {
      await authorize(a.id, workspaceId, "workspace:update");
      const ws = await repo.update(db, workspaceId, patch);
      await audit(a, workspaceId, "workspace.updated", { entityType: "workspace", entityId: workspaceId, metadata: patch });
      return ws;
    },

    async listMembers(a: Actor, workspaceId: string) {
      await authorize(a.id, workspaceId, "members:read");
      return (await repo.listMembers(db, workspaceId)).rows;
    },

    async invite(a: Actor, workspaceId: string, input: { email: string; role: Role }) {
      const actorRole = await authorize(a.id, workspaceId, "members:manage");
      if (!canManageRole(actorRole, input.role)) throw forbidden();
      const token = randomBytes(32).toString("base64url");
      let inv;
      try {
        inv = await repo.createInvitation(db, { workspaceId, ...input, tokenHash: sha256(token), invitedBy: a.id, expiresAt: new Date(Date.now() + INVITE_TTL_MS) });
      } catch (e) {
        if ((e as { code?: string }).code === "23505") throw new AppError(409, "ALREADY_INVITED", "An open invitation already exists for this email");
        throw e;
      }
      await audit(a, workspaceId, "invitation.created", { entityType: "invitation", entityId: inv.id, metadata: { email: input.email, role: input.role } });
      // Email is best effort; the invitation exists regardless and can be re-issued by revoking and inviting again.
      const ws = await repo.get(db, workspaceId);
      await mailer.send({
        to: input.email,
        subject: `You're invited to ${ws?.name ?? "a workspace"}`,
        html: `<p>Accept your invitation: <a href="${appUrl}/accept-invite?token=${token}">accept</a></p>`,
      }).catch(() => {});
      return inv; // raw token is only ever sent by email
    },

    async listInvitations(a: Actor, workspaceId: string) {
      await authorize(a.id, workspaceId, "members:manage");
      return (await repo.listInvitations(db, workspaceId)).rows;
    },

    async revokeInvitation(a: Actor, workspaceId: string, invitationId: string) {
      await authorize(a.id, workspaceId, "members:manage");
      if (!(await repo.revokeInvitation(db, workspaceId, invitationId))) throw notFound("Invitation");
      await audit(a, workspaceId, "invitation.revoked", { entityType: "invitation", entityId: invitationId });
    },

    async acceptInvitation(a: Actor, token: string) {
      return db.tx(async (q) => {
        const inv = await repo.consumeInvitation(q, sha256(token));
        if (!inv) throw badRequest("Invitation is invalid, expired or already used");
        if (inv.email.toLowerCase() !== a.email.toLowerCase()) throw forbidden(); // rolls back the consume
        await repo.addMember(q, inv.workspace_id, a.id, inv.role);
        await auditRepository.record(q, { workspaceId: inv.workspace_id, actorId: a.id, action: "invitation.accepted", entityType: "invitation", entityId: inv.id, ...(a.requestId ? { requestId: a.requestId } : {}) });
        return { workspaceId: inv.workspace_id, role: inv.role };
      });
    },

    async changeRole(a: Actor, workspaceId: string, userId: string, role: Role) {
      return db.tx(async (q) => {
        const actorRole = await repo.getMemberRole(q, workspaceId, a.id);
        if (!actorRole) throw notFound("Workspace");
        if (!can(actorRole, "members:manage")) throw forbidden();
        const current = await repo.getMemberRole(q, workspaceId, userId);
        if (!current) throw notFound("Member");
        if (!canManageRole(actorRole, current) || !canManageRole(actorRole, role)) throw forbidden();
        const owners = await repo.lockOwners(q, workspaceId);
        if (current === "owner" && role !== "owner" && owners.length <= 1) throw new AppError(409, "LAST_OWNER", "A workspace must keep at least one owner");
        await repo.setRole(q, workspaceId, userId, role);
        await auditRepository.record(q, { workspaceId, actorId: a.id, action: "member.role_changed", entityType: "user", entityId: userId, metadata: { from: current, to: role }, ...(a.requestId ? { requestId: a.requestId } : {}) });
        return { userId, role };
      });
    },

    async removeMember(a: Actor, workspaceId: string, userId: string) {
      await db.tx(async (q) => {
        const actorRole = await repo.getMemberRole(q, workspaceId, a.id);
        if (!actorRole) throw notFound("Workspace");
        const target = await repo.getMemberRole(q, workspaceId, userId);
        if (!target) throw notFound("Member");
        const self = a.id === userId;
        if (!self && (!can(actorRole, "members:manage") || !canManageRole(actorRole, target))) throw forbidden();
        const owners = await repo.lockOwners(q, workspaceId);
        if (target === "owner" && owners.length <= 1) throw new AppError(409, "LAST_OWNER", "A workspace must keep at least one owner");
        await repo.removeMember(q, workspaceId, userId);
        await auditRepository.record(q, { workspaceId, actorId: a.id, action: self ? "member.left" : "member.removed", entityType: "user", entityId: userId, ...(a.requestId ? { requestId: a.requestId } : {}) });
      });
    },

    async auditLog(a: Actor, workspaceId: string, limit: number, cursor?: string) {
      await authorize(a.id, workspaceId, "audit:read");
      const before = decodeCursor(cursor, z.object({ id: z.coerce.number() }))?.id;
      const rows = (await auditRepository.list(db, workspaceId, limit, before)).rows;
      return page(rows, limit, (r) => ({ id: r.id }));
    },
  };
}
export type WorkspaceService = ReturnType<typeof createWorkspaceService>;
