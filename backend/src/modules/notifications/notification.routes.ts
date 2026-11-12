import { Router, type RequestHandler } from "express";
import { validate } from "../../shared/middleware/validate.js";
import type { NotificationService } from "./notification.service.js";
import * as s from "./notification.schemas.js";

const actor = (req: Parameters<RequestHandler>[0]) => ({ id: req.user!.id, email: req.user!.email, requestId: req.id });

export function notificationRoutes(svc: NotificationService, authn: RequestHandler) {
  const r = Router();
  r.use(["/workspaces/:workspaceId/notifications", "/workspaces/:workspaceId/notification-preferences"], authn);
  const p = (req: { params: unknown }) => req.params as { workspaceId: string; notificationId: string };
  r.get("/workspaces/:workspaceId/notifications", validate({ params: s.wsParam, query: s.listQuery }), async (req, res) => {
    const { items, nextCursor, unread } = await svc.list(actor(req), p(req).workspaceId, req.query as never);
    res.json({ data: items, meta: { nextCursor, unread } });
  });
  r.post("/workspaces/:workspaceId/notifications/read-all", validate({ params: s.wsParam }), async (req, res) => { res.json({ data: await svc.markAllRead(actor(req), p(req).workspaceId) }); });
  r.post("/workspaces/:workspaceId/notifications/:notificationId/read", validate({ params: s.idParam }), async (req, res) => { await svc.markRead(actor(req), p(req).workspaceId, p(req).notificationId); res.status(204).end(); });
  r.get("/workspaces/:workspaceId/notification-preferences", validate({ params: s.wsParam }), async (req, res) => { res.json({ data: await svc.preferences(actor(req), p(req).workspaceId) }); });
  r.put("/workspaces/:workspaceId/notification-preferences", validate({ params: s.wsParam, body: s.prefsBody }), async (req, res) => { res.json({ data: await svc.setPreferences(actor(req), p(req).workspaceId, req.body.preferences) }); });
  return r;
}
