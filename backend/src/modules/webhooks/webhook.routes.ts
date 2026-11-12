import { Router, type RequestHandler } from "express";
import { validate } from "../../shared/middleware/validate.js";
import type { WebhookService } from "./webhook.service.js";
import * as s from "./webhook.schemas.js";

const actor = (req: Parameters<RequestHandler>[0]) => ({ id: req.user!.id, email: req.user!.email, requestId: req.id });

export function webhookRoutes(svc: WebhookService, authn: RequestHandler) {
  const r = Router();
  const base = "/workspaces/:workspaceId/webhooks";
  r.use(base, authn);
  const p = (req: { params: unknown }) => req.params as { workspaceId: string; webhookId: string };
  r.post(base, validate({ params: s.wsParam, body: s.createBody }), async (req, res) => { res.status(201).json({ data: await svc.create(actor(req), p(req).workspaceId, req.body) }); });
  r.get(base, validate({ params: s.wsParam }), async (req, res) => { res.json({ data: await svc.list(actor(req), p(req).workspaceId), meta: { events: svc.events() } }); });
  r.patch(`${base}/:webhookId`, validate({ params: s.idParam, body: s.updateBody }), async (req, res) => { res.json({ data: await svc.update(actor(req), p(req).workspaceId, p(req).webhookId, req.body) }); });
  r.delete(`${base}/:webhookId`, validate({ params: s.idParam }), async (req, res) => { await svc.remove(actor(req), p(req).workspaceId, p(req).webhookId); res.status(204).end(); });
  r.post(`${base}/:webhookId/rotate-secret`, validate({ params: s.idParam }), async (req, res) => { res.json({ data: await svc.rotateSecret(actor(req), p(req).workspaceId, p(req).webhookId) }); });
  r.post(`${base}/:webhookId/ping`, validate({ params: s.idParam }), async (req, res) => { res.status(202).json({ data: await svc.ping(actor(req), p(req).workspaceId, p(req).webhookId) }); });
  r.get(`${base}/:webhookId/deliveries`, validate({ params: s.idParam, query: s.deliveriesQuery }), async (req, res) => { const { items, nextCursor } = await svc.deliveries(actor(req), p(req).workspaceId, p(req).webhookId, req.query as never); res.json({ data: items, meta: { nextCursor } }); });
  return r;
}
