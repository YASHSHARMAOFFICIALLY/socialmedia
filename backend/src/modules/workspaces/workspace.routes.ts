import { Router, type RequestHandler } from "express";
import { validate } from "../../shared/middleware/validate.js";
import { pageQuery } from "../../shared/utils/pagination.js";
import type { Actor, WorkspaceService } from "./workspace.service.js";
import * as s from "./workspace.schemas.js";

const actor = (req: Parameters<RequestHandler>[0]): Actor => ({ id: req.user!.id, email: req.user!.email, requestId: req.id });
// Express 5 forwards rejected promises to the error handler.
export function workspaceRoutes(svc: WorkspaceService, authn: RequestHandler) {
  const r = Router();
  // Scoped on purpose: a bare r.use(authn) would also guard unrelated routes mounted after this router (e.g. /docs).
  r.use(["/workspaces", "/invitations"], authn);
  const p = (req: { params: unknown }) => req.params as { workspaceId: string; userId: string; invitationId: string };

  r.post("/workspaces", validate({ body: s.createWorkspaceBody }), async (req, res) => {
    res.status(201).json({ data: await svc.create(actor(req), req.body) });
  });
  r.get("/workspaces", validate({ query: pageQuery }), async (req, res) => {
    const q = req.query as unknown as { limit: number; cursor?: string };
    const { items, nextCursor } = await svc.list(actor(req), q.limit, q.cursor);
    res.json({ data: items, meta: { nextCursor } });
  });
  r.get("/workspaces/:workspaceId", validate({ params: s.idParam }), async (req, res) => {
    res.json({ data: await svc.get(actor(req), p(req).workspaceId) });
  });
  r.patch("/workspaces/:workspaceId", validate({ params: s.idParam, body: s.updateWorkspaceBody }), async (req, res) => {
    res.json({ data: await svc.update(actor(req), p(req).workspaceId, req.body) });
  });

  r.delete("/workspaces/:workspaceId", validate({ params: s.idParam, body: s.deleteWorkspaceBody }), async (req, res) => {
    await svc.remove(actor(req), p(req).workspaceId, req.body.confirmName);
    res.status(204).end();
  });

  r.get("/workspaces/:workspaceId/members", validate({ params: s.idParam }), async (req, res) => {
    res.json({ data: await svc.listMembers(actor(req), p(req).workspaceId) });
  });
  r.patch("/workspaces/:workspaceId/members/:userId", validate({ params: s.memberParams, body: s.roleBody }), async (req, res) => {
    res.json({ data: await svc.changeRole(actor(req), p(req).workspaceId, p(req).userId, req.body.role) });
  });
  r.delete("/workspaces/:workspaceId/members/:userId", validate({ params: s.memberParams }), async (req, res) => {
    await svc.removeMember(actor(req), p(req).workspaceId, p(req).userId);
    res.status(204).end();
  });

  r.post("/workspaces/:workspaceId/invitations", validate({ params: s.idParam, body: s.inviteBody }), async (req, res) => {
    res.status(201).json({ data: await svc.invite(actor(req), p(req).workspaceId, req.body) });
  });
  r.get("/workspaces/:workspaceId/invitations", validate({ params: s.idParam }), async (req, res) => {
    res.json({ data: await svc.listInvitations(actor(req), p(req).workspaceId) });
  });
  r.delete("/workspaces/:workspaceId/invitations/:invitationId", validate({ params: s.invitationParams }), async (req, res) => {
    await svc.revokeInvitation(actor(req), p(req).workspaceId, p(req).invitationId);
    res.status(204).end();
  });
  r.post("/invitations/accept", validate({ body: s.acceptBody }), async (req, res) => {
    res.json({ data: await svc.acceptInvitation(actor(req), req.body.token) });
  });

  r.get("/workspaces/:workspaceId/audit-logs", validate({ params: s.idParam, query: pageQuery }), async (req, res) => {
    const q = req.query as unknown as { limit: number; cursor?: string };
    const { items, nextCursor } = await svc.auditLog(actor(req), p(req).workspaceId, q.limit, q.cursor);
    res.json({ data: items, meta: { nextCursor } });
  });
  return r;
}
