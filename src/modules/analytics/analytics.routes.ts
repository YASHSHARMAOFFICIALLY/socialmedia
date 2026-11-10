import { Router, type RequestHandler } from "express";
import { validate } from "../../shared/middleware/validate.js";
import type { AnalyticsService } from "./analytics.service.js";
import * as s from "./analytics.schemas.js";

const actor = (req: Parameters<RequestHandler>[0]) => ({ id: req.user!.id, email: req.user!.email, requestId: req.id });

export function analyticsRoutes(svc: AnalyticsService, authn: RequestHandler) {
  const r = Router();
  const base = "/workspaces/:workspaceId/analytics";
  r.use(base, authn);
  const p = (req: { params: unknown }) => req.params as { workspaceId: string; platform: string; accountId: string; postId: string };
  const q = (req: { query: unknown }) => req.query as never;

  r.get(`${base}/metrics`, validate({ params: s.wsParam }), async (req, res) => { res.json({ data: await svc.definitions(actor(req), p(req).workspaceId) }); });
  r.get(`${base}/sync-status`, validate({ params: s.wsParam }), async (req, res) => { res.json({ data: await svc.syncStatus(actor(req), p(req).workspaceId) }); });
  r.get(`${base}/overview`, validate({ params: s.wsParam, query: s.overviewQuery }), async (req, res) => { res.json({ data: await svc.overview(actor(req), p(req).workspaceId, q(req)) }); });
  r.get(`${base}/platforms/:platform`, validate({ params: s.platformParams, query: s.grainQuery }), async (req, res) => { res.json({ data: await svc.platform(actor(req), p(req).workspaceId, p(req).platform, q(req)) }); });
  r.get(`${base}/accounts/:accountId`, validate({ params: s.accountParams, query: s.grainQuery }), async (req, res) => { res.json({ data: await svc.account(actor(req), p(req).workspaceId, p(req).accountId, q(req)) }); });
  r.get(`${base}/posts/:postId`, validate({ params: s.postParams, query: s.postQuery }), async (req, res) => { res.json({ data: await svc.post(actor(req), p(req).workspaceId, p(req).postId, q(req)) }); });
  r.get(`${base}/trends`, validate({ params: s.wsParam, query: s.trendsQuery }), async (req, res) => { res.json({ data: await svc.trends(actor(req), p(req).workspaceId, q(req)) }); });
  r.get(`${base}/compare/platforms`, validate({ params: s.wsParam, query: s.rangeQuery }), async (req, res) => { res.json({ data: await svc.comparePlatforms(actor(req), p(req).workspaceId, q(req)) }); });
  r.get(`${base}/compare/ranges`, validate({ params: s.wsParam, query: s.compareRangesQuery }), async (req, res) => { res.json({ data: await svc.compareRanges(actor(req), p(req).workspaceId, q(req)) }); });
  r.get(`${base}/top-posts`, validate({ params: s.wsParam, query: s.topQuery }), async (req, res) => { res.json({ data: await svc.topPosts(actor(req), p(req).workspaceId, q(req)) }); });
  return r;
}
