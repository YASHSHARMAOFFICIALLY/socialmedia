import { Router, type RequestHandler } from "express";
import { badRequest } from "../../shared/errors/errors.js";
import { validate } from "../../shared/middleware/validate.js";
import type { PublishingService } from "./publishing.service.js";
import * as s from "./publishing.schemas.js";

const actor = (req: Parameters<RequestHandler>[0]) => ({ id: req.user!.id, email: req.user!.email, requestId: req.id });

export function publishingRoutes(svc: PublishingService, authn: RequestHandler) {
  const r = Router();
  r.use(["/workspaces/:workspaceId/posts/:postId/publish", "/workspaces/:workspaceId/publications"], authn);
  const p = (req: { params: unknown }) => req.params as { workspaceId: string; postId: string; jobId: string };

  r.post("/workspaces/:workspaceId/posts/:postId/publish", validate({ params: s.postParams, body: s.publishBody }), async (req, res) => {
    const key = req.header("idempotency-key");
    if (key !== undefined && !s.idempotencyHeader.safeParse(key).success) throw badRequest("Invalid Idempotency-Key header");
    const out = (await svc.publish(actor(req), p(req).workspaceId, p(req).postId, { accountIds: req.body.accountIds, idempotencyKey: key })) as { replayed?: boolean };
    res.status(out.replayed ? 200 : 202).json({ data: out });
  });
  r.get("/workspaces/:workspaceId/publications", validate({ params: s.wsParam, query: s.listQuery }), async (req, res) => {
    const { items, nextCursor } = await svc.list(actor(req), p(req).workspaceId, req.query as never);
    res.json({ data: items, meta: { nextCursor } });
  });
  r.get("/workspaces/:workspaceId/publications/:jobId", validate({ params: s.jobParams }), async (req, res) => {
    res.json({ data: await svc.get(actor(req), p(req).workspaceId, p(req).jobId) });
  });
  r.post("/workspaces/:workspaceId/publications/:jobId/cancel", validate({ params: s.jobParams }), async (req, res) => {
    await svc.cancel(actor(req), p(req).workspaceId, p(req).jobId);
    res.status(204).end();
  });
  r.post("/workspaces/:workspaceId/publications/:jobId/retry", validate({ params: s.jobParams }), async (req, res) => {
    res.status(202).json({ data: await svc.retry(actor(req), p(req).workspaceId, p(req).jobId) });
  });
  return r;
}
