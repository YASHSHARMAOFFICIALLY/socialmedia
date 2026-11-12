import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { validate } from "../../shared/middleware/validate.js";
import type { InsightsService } from "./insights.service.js";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => !Number.isNaN(Date.parse(d)), "Invalid date");
export const wsParam = z.object({ workspaceId: z.uuid() });
export const insightsQuery = z.object({ from: date.optional(), to: date.optional(), timezone: z.string().default("UTC") });
const actor = (req: Parameters<RequestHandler>[0]) => ({ id: req.user!.id, email: req.user!.email, requestId: req.id });

export function insightsRoutes(svc: InsightsService, authn: RequestHandler) {
  const r = Router();
  r.use("/workspaces/:workspaceId/insights", authn);
  const ws = (req: { params: unknown }) => (req.params as { workspaceId: string }).workspaceId;
  r.get("/workspaces/:workspaceId/insights", validate({ params: wsParam, query: insightsQuery }), async (req, res) => { res.json({ data: await svc.insights(actor(req), ws(req), req.query as never) }); });
  r.get("/workspaces/:workspaceId/insights/recommendations", validate({ params: wsParam, query: insightsQuery }), async (req, res) => { res.json({ data: await svc.recommendations(actor(req), ws(req), req.query as never) }); });
  return r;
}
