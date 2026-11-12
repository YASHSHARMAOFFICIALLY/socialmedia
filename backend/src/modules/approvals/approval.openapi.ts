import { z } from "zod";
import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import * as s from "./approval.schemas.js";
const err = { description: "Error", content: { "application/json": { schema: z.object({ error: z.object({ code: z.string(), message: z.string(), requestId: z.string() }) }) } } };
const ok = (description: string) => ({ description, content: { "application/json": { schema: z.object({ data: z.unknown(), meta: z.object({ nextCursor: z.string().nullable() }).optional() }) } } });
const body = (schema: z.ZodType) => ({ content: { "application/json": { schema } } });
const security = [{ cookieAuth: [] }];
export function registerApprovalDocs(reg: OpenAPIRegistry) {
  const T = ["Approvals"], W = "/workspaces/{workspaceId}";
  reg.registerPath({ method: "get", path: `${W}/approval-policy`, tags: T, security, summary: "Is approval required before publishing, and how many approvals?", request: { params: s.wsParam }, responses: { 200: ok("Policy") } });
  reg.registerPath({ method: "put", path: `${W}/approval-policy`, tags: T, security, summary: "Configure approvals (owner/admin)", request: { params: s.wsParam, body: body(s.policyBody) }, responses: { 200: ok("Policy"), 403: err } });
  reg.registerPath({ method: "post", path: `${W}/posts/{postId}/approval-requests`, tags: T, security, summary: "Writer submits a valid draft for review", request: { params: s.postParams, body: body(s.submitBody) }, responses: { 201: ok("Request"), 409: err, 422: err } });
  reg.registerPath({ method: "get", path: `${W}/approval-requests`, tags: T, security, summary: "List requests", request: { params: s.wsParam, query: s.listQuery }, responses: { 200: ok("Page") } });
  reg.registerPath({ method: "get", path: `${W}/approval-requests/{requestId}`, tags: T, security, summary: "Request with decisions; `stale` is true if the post changed after submission", request: { params: s.requestParams }, responses: { 200: ok("Request"), 404: err } });
  reg.registerPath({ method: "post", path: `${W}/approval-requests/{requestId}/decisions`, tags: T, security, summary: "Reviewer approves or rejects (one vote each; not on own requests; stale content is refused)", request: { params: s.requestParams, body: body(s.decisionBody) }, responses: { 200: ok("Request"), 403: err, 409: err } });
  reg.registerPath({ method: "post", path: `${W}/approval-requests/{requestId}/cancel`, tags: T, security, summary: "Withdraw a pending request", request: { params: s.requestParams }, responses: { 204: { description: "Cancelled" }, 409: err } });
}
