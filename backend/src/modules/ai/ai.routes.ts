import { PLATFORMS } from "../../integrations/core/types.js";
import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { validate } from "../../shared/middleware/validate.js";
import type { AiService } from "./ai.service.js";

export const wsParam = z.object({ workspaceId: z.uuid() });
export const postParams = wsParam.extend({ postId: z.uuid() });
export const adaptBody = z.object({ accountIds: z.array(z.uuid()).min(1).max(20).optional(), tone: z.string().trim().max(80).optional(), instruction: z.string().trim().max(300).optional() }).default({});
export const suggestBody = z.object({ kind: z.enum(["captions", "titles", "hashtags", "rewrite"]), text: z.string().trim().min(1).max(10_000), platform: z.enum(PLATFORMS), count: z.number().int().min(1).max(10).default(3), audience: z.string().trim().max(120).optional(), tone: z.string().trim().max(80).optional() });
const actor = (req: Parameters<RequestHandler>[0]) => ({ id: req.user!.id, email: req.user!.email, requestId: req.id });

export function aiRoutes(svc: AiService, authn: RequestHandler) {
  const r = Router();
  r.use(["/workspaces/:workspaceId/ai", "/workspaces/:workspaceId/posts/:postId/adapt"], authn);
  const p = (req: { params: unknown }) => req.params as { workspaceId: string; postId: string };
  r.get("/workspaces/:workspaceId/ai", validate({ params: wsParam }), async (req, res) => { res.json({ data: await svc.status(actor(req), p(req).workspaceId) }); });
  r.post("/workspaces/:workspaceId/posts/:postId/adapt", validate({ params: postParams, body: adaptBody }), async (req, res) => { res.json({ data: await svc.adapt(actor(req), p(req).workspaceId, p(req).postId, req.body) }); });
  r.post("/workspaces/:workspaceId/ai/suggestions", validate({ params: wsParam, body: suggestBody }), async (req, res) => { res.json({ data: await svc.suggest(actor(req), p(req).workspaceId, req.body) }); });
  return r;
}
