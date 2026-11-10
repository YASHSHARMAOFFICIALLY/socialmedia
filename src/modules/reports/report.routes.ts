import { PLATFORMS } from "../../integrations/core/types.js";
import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { validate } from "../../shared/middleware/validate.js";
import { REPORT_TYPES } from "./report.generators.js";
import type { ReportService } from "./report.service.js";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => !Number.isNaN(Date.parse(d)), "Invalid date");
export const wsParam = z.object({ workspaceId: z.uuid() });
export const idParam = wsParam.extend({ reportId: z.uuid() });
export const createBody = z.object({ type: z.enum(REPORT_TYPES), from: date.optional(), to: date.optional(), platform: z.enum(PLATFORMS).optional(), campaignId: z.uuid().optional(), grain: z.enum(["day", "week", "month"]).optional(), format: z.enum(["csv", "pdf"]).default("csv") });
export const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().max(500).optional() });
const actor = (req: Parameters<RequestHandler>[0]) => ({ id: req.user!.id, email: req.user!.email, requestId: req.id });

export function reportRoutes(svc: ReportService, authn: RequestHandler) {
  const r = Router();
  r.use("/workspaces/:workspaceId/reports", authn);
  const p = (req: { params: unknown }) => req.params as { workspaceId: string; reportId: string };
  r.post("/workspaces/:workspaceId/reports", validate({ params: wsParam, body: createBody }), async (req, res) => { res.status(202).json({ data: await svc.create(actor(req), p(req).workspaceId, req.body) }); });
  r.get("/workspaces/:workspaceId/reports", validate({ params: wsParam, query: listQuery }), async (req, res) => { const { items, nextCursor } = await svc.list(actor(req), p(req).workspaceId, req.query as never); res.json({ data: items, meta: { nextCursor } }); });
  r.get("/workspaces/:workspaceId/reports/:reportId", validate({ params: idParam }), async (req, res) => { res.json({ data: await svc.get(actor(req), p(req).workspaceId, p(req).reportId) }); });
  r.get("/workspaces/:workspaceId/reports/:reportId/download", validate({ params: idParam }), async (req, res) => {
    const { filename, contentType, body } = await svc.download(actor(req), p(req).workspaceId, p(req).reportId);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(body);
  });
  return r;
}
