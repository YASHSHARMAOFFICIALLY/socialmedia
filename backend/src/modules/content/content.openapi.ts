import { z } from "zod";
import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import * as s from "./content.schemas.js";

const err = { description: "Error", content: { "application/json": { schema: z.object({ error: z.object({ code: z.string(), message: z.string(), requestId: z.string() }) }) } } };
const ok = (description: string, schema: z.ZodType) => ({ description, content: { "application/json": { schema: z.object({ data: schema, meta: z.object({ nextCursor: z.string().nullable() }).optional() }) } } });
const body = (schema: z.ZodType) => ({ content: { "application/json": { schema } } });
const security = [{ cookieAuth: [] }];
const Post = z.object({ id: z.uuid(), title: z.string().nullable(), body: z.string(), hashtags: z.array(z.string()), labels: z.array(z.string()), status: z.enum(["draft", "submitted"]), variants: z.array(z.record(z.string(), z.unknown())), media: z.array(z.record(z.string(), z.unknown())) });
const Issue = z.object({ code: z.string(), field: z.string(), message: z.string(), severity: z.enum(["error", "warning"]) });
const Report = z.object({ valid: z.boolean(), publishable: z.boolean(), issues: z.array(Issue), variants: z.array(z.object({ accountId: z.uuid(), platform: z.string(), valid: z.boolean(), publishable: z.boolean(), publishBlockers: z.array(z.string()), issues: z.array(Issue) })) });

export function registerContentDocs(reg: OpenAPIRegistry) {
  const T = ["Content"], B = "/workspaces/{workspaceId}/posts";
  reg.registerPath({ method: "post", path: B, tags: T, security, summary: "Create a draft post with optional per-account variants", request: { params: s.wsParam, body: body(s.createPostBody) }, responses: { 201: ok("Created", Post), 400: err, 403: err } });
  reg.registerPath({ method: "get", path: B, tags: T, security, summary: "List posts (filter by status/label/text)", request: { params: s.wsParam, query: s.listQuery }, responses: { 200: ok("Page", z.array(Post.partial())) } });
  reg.registerPath({ method: "get", path: `${B}/{postId}`, tags: T, security, summary: "Get post with variants and media", request: { params: s.postParams }, responses: { 200: ok("Post", Post), 404: err } });
  reg.registerPath({ method: "patch", path: `${B}/{postId}`, tags: T, security, summary: "Edit a draft", request: { params: s.postParams, body: body(s.updatePostBody) }, responses: { 200: ok("Post", Post), 409: err } });
  reg.registerPath({ method: "delete", path: `${B}/{postId}`, tags: T, security, summary: "Delete a draft", request: { params: s.postParams }, responses: { 204: { description: "Deleted" }, 409: err } });
  reg.registerPath({ method: "post", path: `${B}/{postId}/duplicate`, tags: T, security, summary: "Duplicate a post as a new draft", request: { params: s.postParams }, responses: { 201: ok("Copy", Post) } });
  reg.registerPath({ method: "put", path: `${B}/{postId}/variants/{accountId}`, tags: T, security, summary: "Create/replace the variant for one destination account", request: { params: s.variantParams, body: body(s.variantInput.omit({ accountId: true })) }, responses: { 200: ok("Post", Post), 400: err, 409: err } });
  reg.registerPath({ method: "delete", path: `${B}/{postId}/variants/{accountId}`, tags: T, security, summary: "Remove a destination", request: { params: s.variantParams }, responses: { 204: { description: "Removed" }, 404: err } });
  reg.registerPath({ method: "post", path: `${B}/{postId}/validate`, tags: T, security, summary: "Validate every variant against its platform's rules; reports errors, unverified-rule warnings and publish blockers", request: { params: s.postParams }, responses: { 200: ok("Report", Report) } });
}
