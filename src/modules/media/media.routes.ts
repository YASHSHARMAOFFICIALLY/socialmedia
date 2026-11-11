import { Router, type RequestHandler } from "express";
import { validate } from "../../shared/middleware/validate.js";
import type { MediaService } from "./media.service.js";
import * as s from "./media.schemas.js";

const actor = (req: Parameters<RequestHandler>[0]) => ({ id: req.user!.id, email: req.user!.email, requestId: req.id });

export function mediaRoutes(svc: MediaService, authn: RequestHandler) {
  const r = Router();
  r.use("/workspaces/:workspaceId/media", authn);
  const p = (req: { params: unknown }) => req.params as { workspaceId: string; mediaId: string };
  const base = "/workspaces/:workspaceId/media";

  r.post(`${base}/uploads`, validate({ params: s.wsParam, body: s.uploadBody }), async (req, res) => {
    res.status(201).json({ data: await svc.createUpload(actor(req), p(req).workspaceId, req.body) });
  });
  r.post(`${base}/:mediaId/confirm`, validate({ params: s.mediaParams }), async (req, res) => {
    res.json({ data: await svc.confirm(actor(req), p(req).workspaceId, p(req).mediaId) });
  });
  r.get(base, validate({ params: s.wsParam, query: s.listQuery }), async (req, res) => {
    const { items, nextCursor } = await svc.list(actor(req), p(req).workspaceId, req.query as never);
    res.json({ data: items, meta: { nextCursor } });
  });
  r.get(`${base}/:mediaId`, validate({ params: s.mediaParams }), async (req, res) => {
    res.json({ data: await svc.get(actor(req), p(req).workspaceId, p(req).mediaId) });
  });
  r.get(`${base}/:mediaId/compatibility`, validate({ params: s.mediaParams }), async (req, res) => {
    res.json({ data: await svc.compatibility(actor(req), p(req).workspaceId, p(req).mediaId) });
  });
  r.post(`${base}/:mediaId/derivatives`, validate({ params: s.mediaParams, body: s.derivativeBody }), async (req, res) => {
    res.status(201).json({ data: await svc.createDerivative(actor(req), p(req).workspaceId, p(req).mediaId, req.body) });
  });
  r.post(`${base}/:mediaId/video-derivatives`, validate({ params: s.mediaParams, body: s.videoDerivativeBody }), async (req, res) => {
    res.status(201).json({ data: await svc.createVideoDerivative(actor(req), p(req).workspaceId, p(req).mediaId, req.body) });
  });
  r.delete(`${base}/:mediaId`, validate({ params: s.mediaParams }), async (req, res) => {
    await svc.remove(actor(req), p(req).workspaceId, p(req).mediaId);
    res.status(204).end();
  });
  return r;
}
