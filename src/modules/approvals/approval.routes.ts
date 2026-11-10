import { Router, type RequestHandler } from "express";
import { validate } from "../../shared/middleware/validate.js";
import type { ApprovalService } from "./approval.service.js";
import * as s from "./approval.schemas.js";

const actor = (req: Parameters<RequestHandler>[0]) => ({ id: req.user!.id, email: req.user!.email, requestId: req.id });

export function approvalRoutes(svc: ApprovalService, authn: RequestHandler) {
  const r = Router();
  r.use(["/workspaces/:workspaceId/approval-policy", "/workspaces/:workspaceId/approval-requests", "/workspaces/:workspaceId/posts/:postId/approval-requests"], authn);
  const p = (req: { params: unknown }) => req.params as { workspaceId: string; postId: string; requestId: string };
  r.get("/workspaces/:workspaceId/approval-policy", validate({ params: s.wsParam }), async (req, res) => { res.json({ data: await svc.getPolicy(actor(req), p(req).workspaceId) }); });
  r.put("/workspaces/:workspaceId/approval-policy", validate({ params: s.wsParam, body: s.policyBody }), async (req, res) => { res.json({ data: await svc.setPolicy(actor(req), p(req).workspaceId, req.body) }); });
  r.post("/workspaces/:workspaceId/posts/:postId/approval-requests", validate({ params: s.postParams, body: s.submitBody }), async (req, res) => { res.status(201).json({ data: await svc.submit(actor(req), p(req).workspaceId, p(req).postId, req.body.note) }); });
  r.get("/workspaces/:workspaceId/approval-requests", validate({ params: s.wsParam, query: s.listQuery }), async (req, res) => {
    const { items, nextCursor } = await svc.list(actor(req), p(req).workspaceId, req.query as never);
    res.json({ data: items, meta: { nextCursor } });
  });
  r.get("/workspaces/:workspaceId/approval-requests/:requestId", validate({ params: s.requestParams }), async (req, res) => { res.json({ data: await svc.get(actor(req), p(req).workspaceId, p(req).requestId) }); });
  r.post("/workspaces/:workspaceId/approval-requests/:requestId/decisions", validate({ params: s.requestParams, body: s.decisionBody }), async (req, res) => { res.json({ data: await svc.decide(actor(req), p(req).workspaceId, p(req).requestId, req.body.decision, req.body.comment) }); });
  r.post("/workspaces/:workspaceId/approval-requests/:requestId/cancel", validate({ params: s.requestParams }), async (req, res) => { await svc.cancel(actor(req), p(req).workspaceId, p(req).requestId); res.status(204).end(); });
  return r;
}
