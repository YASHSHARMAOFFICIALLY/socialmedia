import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { validate } from "../../shared/middleware/validate.js";
import type { RecurringService } from "./recurring.service.js";
import * as s from "./recurring.schemas.js";

const actor = (req: Parameters<RequestHandler>[0]) => ({ id: req.user!.id, email: req.user!.email, requestId: req.id });

export function recurringRoutes(svc: RecurringService, authn: RequestHandler) {
  const r = Router();
  r.use(["/workspaces/:workspaceId/recurrences", "/workspaces/:workspaceId/posts/:postId/recurrence"], authn);
  const p = (req: { params: unknown }) => req.params as { workspaceId: string; postId: string; seriesId: string };
  r.post("/workspaces/:workspaceId/posts/:postId/recurrence", validate({ params: s.postParams, body: s.createBody }), async (req, res) => { res.status(201).json({ data: await svc.create(actor(req), p(req).workspaceId, p(req).postId, req.body) }); });
  r.get("/workspaces/:workspaceId/recurrences", validate({ params: s.wsParam, query: s.listQuery }), async (req, res) => { const { items, nextCursor } = await svc.list(actor(req), p(req).workspaceId, req.query as never); res.json({ data: items, meta: { nextCursor } }); });
  r.get("/workspaces/:workspaceId/recurrences/:seriesId", validate({ params: s.seriesParams }), async (req, res) => { res.json({ data: await svc.get(actor(req), p(req).workspaceId, p(req).seriesId) }); });
  r.patch("/workspaces/:workspaceId/recurrences/:seriesId", validate({ params: s.seriesParams, body: s.patchBody }), async (req, res) => { res.json({ data: await svc.setStatus(actor(req), p(req).workspaceId, p(req).seriesId, req.body.status) }); });
  r.delete("/workspaces/:workspaceId/recurrences/:seriesId", validate({ params: s.seriesParams, query: z.object({ cancelScheduled: z.enum(["true", "false"]).default("false") }) }), async (req, res) => { res.json({ data: await svc.end(actor(req), p(req).workspaceId, p(req).seriesId, (req.query as { cancelScheduled: string }).cancelScheduled === "true") }); });
  return r;
}
