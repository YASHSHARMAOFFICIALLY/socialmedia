import { Router, type RequestHandler } from "express";
import { validate } from "../../shared/middleware/validate.js";
import type { ContentService } from "./content.service.js";
import * as s from "./content.schemas.js";

const actor = (req: Parameters<RequestHandler>[0]) => ({ id: req.user!.id, email: req.user!.email, requestId: req.id });

export function contentRoutes(svc: ContentService, authn: RequestHandler) {
  const r = Router();
  r.use("/workspaces/:workspaceId/posts", authn);
  const p = (req: { params: unknown }) => req.params as { workspaceId: string; postId: string; accountId: string };
  const base = "/workspaces/:workspaceId/posts";

  r.post(base, validate({ params: s.wsParam, body: s.createPostBody }), async (req, res) => {
    res.status(201).json({ data: await svc.create(actor(req), p(req).workspaceId, req.body) });
  });
  r.get(base, validate({ params: s.wsParam, query: s.listQuery }), async (req, res) => {
    const { items, nextCursor } = await svc.list(actor(req), p(req).workspaceId, req.query as never);
    res.json({ data: items, meta: { nextCursor } });
  });
  r.get(`${base}/:postId`, validate({ params: s.postParams }), async (req, res) => {
    res.json({ data: await svc.get(actor(req), p(req).workspaceId, p(req).postId) });
  });
  r.patch(`${base}/:postId`, validate({ params: s.postParams, body: s.updatePostBody }), async (req, res) => {
    res.json({ data: await svc.update(actor(req), p(req).workspaceId, p(req).postId, req.body) });
  });
  r.delete(`${base}/:postId`, validate({ params: s.postParams }), async (req, res) => {
    await svc.remove(actor(req), p(req).workspaceId, p(req).postId);
    res.status(204).end();
  });
  r.post(`${base}/:postId/duplicate`, validate({ params: s.postParams }), async (req, res) => {
    res.status(201).json({ data: await svc.duplicate(actor(req), p(req).workspaceId, p(req).postId) });
  });
  r.put(`${base}/:postId/variants/:accountId`, validate({ params: s.variantParams, body: s.variantInput.omit({ accountId: true }) }), async (req, res) => {
    res.json({ data: await svc.putVariant(actor(req), p(req).workspaceId, p(req).postId, { ...req.body, accountId: p(req).accountId }) });
  });
  r.delete(`${base}/:postId/variants/:accountId`, validate({ params: s.variantParams }), async (req, res) => {
    await svc.removeVariant(actor(req), p(req).workspaceId, p(req).postId, p(req).accountId);
    res.status(204).end();
  });
  r.post(`${base}/:postId/validate`, validate({ params: s.postParams }), async (req, res) => {
    res.json({ data: await svc.validate(actor(req), p(req).workspaceId, p(req).postId) });
  });
  return r;
}
