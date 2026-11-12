import { Router, type RequestHandler } from "express";
import { createPostBody } from "../content/content.schemas.js";
import { validate } from "../../shared/middleware/validate.js";
import type { SchedulingService } from "./scheduling.service.js";
import * as s from "./scheduling.schemas.js";

const actor = (req: Parameters<RequestHandler>[0]) => ({ id: req.user!.id, email: req.user!.email, requestId: req.id });

export function schedulingRoutes(svc: SchedulingService, authn: RequestHandler) {
  const r = Router();
  r.use(["/workspaces/:workspaceId/calendar", "/workspaces/:workspaceId/bulk", "/workspaces/:workspaceId/posts/:postId/schedule"], authn);
  const p = (req: { params: unknown }) => req.params as { workspaceId: string; postId: string };
  const sc = "/workspaces/:workspaceId/posts/:postId/schedule";

  r.post(sc, validate({ params: s.postParams, body: s.scheduleBody }), async (req, res) => { res.status(202).json({ data: await svc.schedule(actor(req), p(req).workspaceId, p(req).postId, req.body) }); });
  r.get(sc, validate({ params: s.postParams }), async (req, res) => { res.json({ data: await svc.getSchedule(actor(req), p(req).workspaceId, p(req).postId) }); });
  r.put(sc, validate({ params: s.postParams, body: s.rescheduleBody }), async (req, res) => { res.json({ data: await svc.reschedule(actor(req), p(req).workspaceId, p(req).postId, req.body) }); });
  r.delete(sc, validate({ params: s.postParams }), async (req, res) => { res.json({ data: await svc.cancelSchedule(actor(req), p(req).workspaceId, p(req).postId) }); });

  r.get("/workspaces/:workspaceId/calendar", validate({ params: s.wsParam, query: s.calendarQuery }), async (req, res) => {
    res.json({ data: await svc.calendar(actor(req), p(req).workspaceId, req.query as never) });
  });

  // Bulk endpoints answer 200 with per-item results (an item failing is data, not an HTTP error).
  r.post("/workspaces/:workspaceId/bulk/posts", validate({ params: s.wsParam, body: s.bulkCreateBody }), async (req, res) => {
    const parsed = req.body.posts.map((x: unknown) => createPostBody.safeParse(x));
    const valid = parsed.flatMap((x: ReturnType<typeof createPostBody.safeParse>, i: number) => (x.success ? [{ i, v: x.data }] : []));
    const out = await svc.bulkCreate(actor(req), p(req).workspaceId, valid.map((x: { v: never }) => x.v));
    // re-map results back to the caller's indexes and include validation failures
    const results = parsed.map((x: ReturnType<typeof createPostBody.safeParse>, i: number) => {
      if (!x.success) return { index: i, ok: false, error: { code: "VALIDATION_ERROR", message: "Invalid post", details: x.error.issues } };
      const pos = valid.findIndex((v: { i: number }) => v.i === i);
      return { ...out.results[pos]!, index: i };
    });
    res.json({ data: { total: results.length, succeeded: results.filter((x: { ok: boolean }) => x.ok).length, failed: results.filter((x: { ok: boolean }) => !x.ok).length, results } });
  });
  r.post("/workspaces/:workspaceId/bulk/schedule", validate({ params: s.wsParam, body: s.bulkScheduleBody }), async (req, res) => { res.json({ data: await svc.bulkSchedule(actor(req), p(req).workspaceId, req.body.items) }); });
  r.post("/workspaces/:workspaceId/bulk/cancel", validate({ params: s.wsParam, body: s.bulkIdsBody }), async (req, res) => { res.json({ data: await svc.bulkCancel(actor(req), p(req).workspaceId, req.body.ids) }); });
  r.post("/workspaces/:workspaceId/bulk/status", validate({ params: s.wsParam, body: s.bulkIdsBody }), async (req, res) => { res.json({ data: await svc.bulkStatus(actor(req), p(req).workspaceId, req.body.ids) }); });
  return r;
}
