import { Router, type RequestHandler } from "express";
import { validate } from "../../shared/middleware/validate.js";
import type { CampaignService } from "./campaign.service.js";
import * as s from "./campaign.schemas.js";

const actor = (req: Parameters<RequestHandler>[0]) => ({ id: req.user!.id, email: req.user!.email, requestId: req.id });

export function campaignRoutes(svc: CampaignService, authn: RequestHandler) {
  const r = Router();
  const base = "/workspaces/:workspaceId/campaigns";
  r.use(base, authn);
  const p = (req: { params: unknown }) => req.params as { workspaceId: string; campaignId: string; postId: string };
  const q = (req: { query: unknown }) => req.query as never;

  r.post(base, validate({ params: s.wsParam, body: s.createBody }), async (req, res) => { res.status(201).json({ data: await svc.create(actor(req), p(req).workspaceId, req.body) }); });
  r.get(base, validate({ params: s.wsParam, query: s.listQuery }), async (req, res) => {
    const { items, nextCursor } = await svc.list(actor(req), p(req).workspaceId, q(req));
    res.json({ data: items.map(({ createdAtRaw: _c, ...x }) => x), meta: { nextCursor } });
  });
  r.get(`${base}/compare`, validate({ params: s.wsParam, query: s.compareQuery }), async (req, res) => { res.json({ data: await svc.compare(actor(req), p(req).workspaceId, q(req)) }); });
  r.get(`${base}/:campaignId`, validate({ params: s.campaignParams }), async (req, res) => { res.json({ data: await svc.get(actor(req), p(req).workspaceId, p(req).campaignId) }); });
  r.patch(`${base}/:campaignId`, validate({ params: s.campaignParams, body: s.updateBody }), async (req, res) => { res.json({ data: await svc.update(actor(req), p(req).workspaceId, p(req).campaignId, req.body) }); });
  r.post(`${base}/:campaignId/posts`, validate({ params: s.campaignParams, body: s.addPostsBody }), async (req, res) => { res.json({ data: await svc.addPosts(actor(req), p(req).workspaceId, p(req).campaignId, req.body.postIds) }); });
  r.delete(`${base}/:campaignId/posts/:postId`, validate({ params: s.campaignPostParams }), async (req, res) => { await svc.removePost(actor(req), p(req).workspaceId, p(req).campaignId, p(req).postId); res.status(204).end(); });
  r.get(`${base}/:campaignId/performance`, validate({ params: s.campaignParams, query: s.performanceQuery }), async (req, res) => { res.json({ data: await svc.performance(actor(req), p(req).workspaceId, p(req).campaignId, q(req)) }); });
  return r;
}
