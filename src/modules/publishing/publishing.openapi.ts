import { z } from "zod";
import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import * as s from "./publishing.schemas.js";

const err = { description: "Error", content: { "application/json": { schema: z.object({ error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional(), requestId: z.string() }) }) } } };
const ok = (description: string, schema: z.ZodType) => ({ description, content: { "application/json": { schema: z.object({ data: schema, meta: z.object({ nextCursor: z.string().nullable() }).optional() }) } } });
const security = [{ cookieAuth: [] }];
const Job = z.object({
  id: z.uuid(), post_id: z.uuid(), variant_id: z.uuid(), social_account_id: z.uuid(), platform: z.string(),
  status: z.enum(["pending", "scheduled", "processing", "published", "failed", "cancelled"]),
  attempt_count: z.number(), max_attempts: z.number(), needs_reconciliation: z.boolean(),
  external_id: z.string().nullable(), external_url: z.string().nullable(), failure_kind: z.string().nullable(), failure_message: z.string().nullable(),
});

export function registerPublishingDocs(reg: OpenAPIRegistry) {
  const T = ["Publishing"];
  reg.registerPath({
    method: "post", path: "/workspaces/{workspaceId}/posts/{postId}/publish", tags: T, security,
    summary: "Publish now: one independent job per destination (failures never affect other platforms)",
    description: "Send an `Idempotency-Key` header to make retries of this request safe. Returns 202 with the created jobs; poll /publications for status. 422 POST_NOT_PUBLISHABLE lists per-destination blockers.",
    request: { params: s.postParams, body: { content: { "application/json": { schema: s.publishBody } } } },
    responses: { 202: ok("Accepted", z.object({ jobs: z.array(Job), skipped: z.array(z.uuid()) })), 200: ok("Replayed idempotent request", z.object({ jobs: z.array(Job) })), 409: err, 422: err },
  });
  reg.registerPath({ method: "get", path: "/workspaces/{workspaceId}/publications", tags: T, security, summary: "Publishing status/history list", request: { params: s.wsParam, query: s.listQuery }, responses: { 200: ok("Page", z.array(Job)) } });
  reg.registerPath({ method: "get", path: "/workspaces/{workspaceId}/publications/{jobId}", tags: T, security, summary: "One publication with attempt history and state transitions", request: { params: s.jobParams }, responses: { 200: ok("Job", Job.extend({ attempts: z.array(z.record(z.string(), z.unknown())), events: z.array(z.record(z.string(), z.unknown())) })), 404: err } });
  reg.registerPath({ method: "post", path: "/workspaces/{workspaceId}/publications/{jobId}/cancel", tags: T, security, summary: "Cancel a pending/scheduled publication", request: { params: s.jobParams }, responses: { 204: { description: "Cancelled" }, 409: err } });
  reg.registerPath({ method: "post", path: "/workspaces/{workspaceId}/publications/{jobId}/retry", tags: T, security, summary: "Retry a failed publication", request: { params: s.jobParams }, responses: { 202: ok("Re-queued", Job), 409: err } });
}
