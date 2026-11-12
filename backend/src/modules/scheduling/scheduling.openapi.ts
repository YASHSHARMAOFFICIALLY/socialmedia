import { z } from "zod";
import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import * as s from "./scheduling.schemas.js";

const err = { description: "Error", content: { "application/json": { schema: z.object({ error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional(), requestId: z.string() }) }) } } };
const ok = (description: string, schema: z.ZodType) => ({ description, content: { "application/json": { schema: z.object({ data: schema }) } } });
const body = (schema: z.ZodType) => ({ content: { "application/json": { schema } } });
const security = [{ cookieAuth: [] }];
const Bulk = z.object({ total: z.number(), succeeded: z.number(), failed: z.number(), results: z.array(z.record(z.string(), z.unknown())) });

export function registerSchedulingDocs(reg: OpenAPIRegistry) {
  const T = ["Scheduling"], P = "/workspaces/{workspaceId}/posts/{postId}/schedule";
  reg.registerPath({ method: "post", path: P, tags: T, security, summary: "Schedule a post: absolute `scheduledAt` or DST-aware `localDateTime`+`timezone`", description: "Creates one scheduled job per destination. 409 SCHEDULE_CONFLICT if another post is scheduled on the same account within 5 minutes (override with allowConflicts). Ambiguous daylight-saving times resolve to the earlier occurrence (a warning is returned); non-existent times are rejected.", request: { params: s.postParams, body: body(s.scheduleBody) }, responses: { 202: ok("Scheduled", z.record(z.string(), z.unknown())), 400: err, 409: err, 422: err } });
  reg.registerPath({ method: "get", path: P, tags: T, security, summary: "Schedule state (scheduled | fired | cancelled)", request: { params: s.postParams }, responses: { 200: ok("Schedule", z.record(z.string(), z.unknown())), 404: err } });
  reg.registerPath({ method: "put", path: P, tags: T, security, summary: "Reschedule (calendar drag-and-drop)", request: { params: s.postParams, body: body(s.rescheduleBody) }, responses: { 200: ok("Rescheduled", z.record(z.string(), z.unknown())), 409: err } });
  reg.registerPath({ method: "delete", path: P, tags: T, security, summary: "Cancel the schedule; the post becomes an editable draft again if nothing else exists for it", request: { params: s.postParams }, responses: { 200: ok("Cancelled", z.record(z.string(), z.unknown())), 409: err } });
  reg.registerPath({ method: "get", path: "/workspaces/{workspaceId}/calendar", tags: T, security, summary: "Calendar data: `month=YYYY-MM`, `weekOf=YYYY-MM-DD` or `from`+`to` (max 62 days), grouped by local day, plus unscheduled drafts", request: { params: s.wsParam, query: s.calendarQuery }, responses: { 200: ok("Calendar", z.record(z.string(), z.unknown())), 400: err } });
  reg.registerPath({ method: "post", path: "/workspaces/{workspaceId}/bulk/posts", tags: T, security, summary: "Create up to 50 drafts; each is validated and saved independently", request: { params: s.wsParam, body: body(s.bulkCreateBody) }, responses: { 200: ok("Per-item results", Bulk) } });
  reg.registerPath({ method: "post", path: "/workspaces/{workspaceId}/bulk/schedule", tags: T, security, summary: "Schedule up to 100 posts; each succeeds or fails on its own", request: { params: s.wsParam, body: body(s.bulkScheduleBody) }, responses: { 200: ok("Per-item results", Bulk) } });
  reg.registerPath({ method: "post", path: "/workspaces/{workspaceId}/bulk/cancel", tags: T, security, summary: "Cancel up to 200 publications", request: { params: s.wsParam, body: body(s.bulkIdsBody) }, responses: { 200: ok("Per-item results", Bulk) } });
  reg.registerPath({ method: "post", path: "/workspaces/{workspaceId}/bulk/status", tags: T, security, summary: "Status of up to 200 publications in one call", request: { params: s.wsParam, body: body(s.bulkIdsBody) }, responses: { 200: ok("Statuses", z.array(z.record(z.string(), z.unknown()))) } });
}
