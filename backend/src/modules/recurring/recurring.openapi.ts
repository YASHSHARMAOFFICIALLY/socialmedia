import { z } from "zod";
import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import * as s from "./recurring.schemas.js";
const err = { description: "Error", content: { "application/json": { schema: z.object({ error: z.object({ code: z.string(), message: z.string(), requestId: z.string() }) }) } } };
const ok = (d: string) => ({ description: d, content: { "application/json": { schema: z.object({ data: z.unknown(), meta: z.object({ nextCursor: z.string().nullable() }).optional() }) } } });
const security = [{ cookieAuth: [] }];
export function registerRecurringDocs(reg: OpenAPIRegistry) {
  const T = ["Recurring posts"], W = "/workspaces/{workspaceId}";
  reg.registerPath({ method: "post", path: `${W}/posts/{postId}/recurrence`, tags: T, security, summary: "Start a recurring series from a draft template (daily/weekly/monthly, wall-clock time in a zone, DST-aware)", description: "Each occurrence publishes a fresh COPY of the template as it is at that moment (edit the template to change future posts). `count` or `untilDate` is required. With approvals required, copies need approval and fail with a notification otherwise. Occurrences are created 24 h ahead.", request: { params: s.postParams, body: { content: { "application/json": { schema: s.createBody } } } }, responses: { 201: ok("Series"), 400: err, 409: err, 422: err } });
  reg.registerPath({ method: "get", path: `${W}/recurrences`, tags: T, security, summary: "List series", request: { params: s.wsParam, query: s.listQuery }, responses: { 200: ok("Page") } });
  reg.registerPath({ method: "get", path: `${W}/recurrences/{seriesId}`, tags: T, security, summary: "Series with its occurrences", request: { params: s.seriesParams }, responses: { 200: ok("Series"), 404: err } });
  reg.registerPath({ method: "patch", path: `${W}/recurrences/{seriesId}`, tags: T, security, summary: "Pause / resume", request: { params: s.seriesParams, body: { content: { "application/json": { schema: s.patchBody } } } }, responses: { 200: ok("Series"), 409: err } });
  reg.registerPath({ method: "delete", path: `${W}/recurrences/{seriesId}`, tags: T, security, summary: "End a series (`?cancelScheduled=true` also cancels copies that are still scheduled)", request: { params: s.seriesParams }, responses: { 200: ok("Ended") } });
}
