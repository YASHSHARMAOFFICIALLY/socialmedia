import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { Db } from "../../infrastructure/database/db.js";
import { AppError, badRequest } from "../../shared/errors/errors.js";
import { validate } from "../../shared/middleware/validate.js";
import { auditRepository } from "../audit/audit.repository.js";

/**
 * Self-service account erasure. The user row cannot be deleted (posts, audit entries and approvals reference it), so it is ANONYMIZED:
 * identity (name, email, image), every login method, session, verification token, workspace membership and MCP grant are removed. Content the
 * person created stays in the workspaces it belongs to, attributed to "Deleted user".
 */
export function createMeService(db: Db) {
  return {
    async deleteAccount(user: { id: string; email: string }, confirmEmail: string, requestId?: string) {
      if (confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()) throw badRequest("The confirmation email does not match your account");
      await db.tx(async (q) => {
        // Never orphan a workspace: sole owners must hand it over (or delete it) first.
        const stuck = (await q.query<{ id: string; name: string; members: number }>(
          `SELECT w.id, w.name, (SELECT count(*)::int FROM workspace_members x WHERE x.workspace_id = w.id) AS members
             FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
            WHERE m.user_id = $1 AND m.role = 'owner' AND NOT EXISTS (SELECT 1 FROM workspace_members o WHERE o.workspace_id = w.id AND o.role = 'owner' AND o.user_id <> $1)`, [user.id])).rows;
        if (stuck.length) throw new AppError(409, "OWNS_WORKSPACES", "Transfer ownership or delete these workspaces first", { workspaces: stuck.map((w) => ({ id: w.id, name: w.name, otherMembers: w.members - 1 })) });
        await auditRepository.record(q, { workspaceId: null, actorId: user.id, action: "account.deleted", entityType: "user", entityId: user.id, metadata: {}, ...(requestId ? { requestId } : {}) });
        await q.query("DELETE FROM workspace_members WHERE user_id = $1", [user.id]);
        await q.query("DELETE FROM mcp_grants WHERE user_id = $1", [user.id]);
        await q.query(`DELETE FROM "session" WHERE "userId" = $1`, [user.id]);
        await q.query(`DELETE FROM "account" WHERE "userId" = $1`, [user.id]);
        const literal = user.email.replace(/[\\%_]/g, (ch) => `\\${ch}`);   // _ and % in an email are not wildcards
        await q.query(`DELETE FROM "verification" WHERE identifier = $1 OR identifier LIKE $2 ESCAPE '\\'`, [user.email, `%${literal}%`]);
        await q.query(
          `UPDATE "user" SET name = 'Deleted user', email = $2, "emailVerified" = false, image = NULL, username = NULL, "displayUsername" = NULL WHERE id = $1`,
          [user.id, `deleted-${user.id}@deleted.invalid`]);
      });
    },
  };
}
export type MeService = ReturnType<typeof createMeService>;

export function meRoutes(svc: MeService, authn: RequestHandler) {
  const r = Router();
  r.delete("/me", authn, validate({ body: z.object({ confirmEmail: z.string().min(3).max(254) }) }), async (req, res) => {
    await svc.deleteAccount({ id: req.user!.id, email: req.user!.email }, req.body.confirmEmail, req.id);
    res.status(204).end();
  });
  return r;
}
