import { PLATFORMS } from "../../integrations/core/types.js";
import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { validate } from "../../shared/middleware/validate.js";
import type { CompetitorService } from "./competitor.service.js";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => !Number.isNaN(Date.parse(d)), "Invalid date");
const platform = z.enum(PLATFORMS);
export const wsParam = z.object({ workspaceId: z.uuid() });
export const idParam = wsParam.extend({ competitorId: z.uuid() });
export const addBody = z.object({ platform, handle: z.string().trim().min(2).max(200) });
export const rangeQuery = z.object({ from: date.optional(), to: date.optional() });
export const compareQuery = rangeQuery.extend({ platform });
const actor = (req: Parameters<RequestHandler>[0]) => ({ id: req.user!.id, email: req.user!.email, requestId: req.id });

export function competitorRoutes(svc: CompetitorService, authn: RequestHandler) {
  const r = Router();
  const base = "/workspaces/:workspaceId/competitors";
  r.use(base, authn);
  const p = (req: { params: unknown }) => req.params as { workspaceId: string; competitorId: string };
  r.post(base, validate({ params: wsParam, body: addBody }), async (req, res) => { res.status(201).json({ data: await svc.add(actor(req), p(req).workspaceId, req.body) }); });
  r.get(base, validate({ params: wsParam }), async (req, res) => { res.json({ data: await svc.list(actor(req), p(req).workspaceId) }); });
  r.get(`${base}/compare`, validate({ params: wsParam, query: compareQuery }), async (req, res) => { res.json({ data: await svc.compare(actor(req), p(req).workspaceId, req.query as never) }); });
  r.get(`${base}/:competitorId`, validate({ params: idParam, query: rangeQuery }), async (req, res) => { res.json({ data: await svc.get(actor(req), p(req).workspaceId, p(req).competitorId, req.query as never) }); });
  r.delete(`${base}/:competitorId`, validate({ params: idParam }), async (req, res) => { await svc.remove(actor(req), p(req).workspaceId, p(req).competitorId); res.status(204).end(); });
  return r;
}
