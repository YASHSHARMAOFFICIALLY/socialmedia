import { z } from "zod";
import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import * as s from "./media.schemas.js";

const err = { description: "Error", content: { "application/json": { schema: z.object({ error: z.object({ code: z.string(), message: z.string(), requestId: z.string() }) }) } } };
const ok = (description: string, schema: z.ZodType) => ({ description, content: { "application/json": { schema: z.object({ data: schema, meta: z.object({ nextCursor: z.string().nullable() }).optional() }) } } });
const security = [{ cookieAuth: [] }];
const Media = z.object({ id: z.uuid(), kind: z.enum(["image", "video"]), filename: z.string(), mime_type: z.string(), size_bytes: z.string(), width: z.number().nullable(), height: z.number().nullable(), status: z.enum(["pending_upload", "uploaded", "ready", "failed"]) });

export function registerMediaDocs(reg: OpenAPIRegistry) {
  const T = ["Media"], B = "/workspaces/{workspaceId}/media";
  reg.registerPath({ method: "post", path: `${B}/uploads`, tags: T, security, summary: "1) Register an upload and get a presigned PUT URL (send the returned headers; Content-Type is signed)", request: { params: s.wsParam, body: { content: { "application/json": { schema: s.uploadBody } } } }, responses: { 201: ok("Upload", z.object({ media: Media, upload: z.object({ method: z.literal("PUT"), url: z.string(), headers: z.record(z.string(), z.string()), expiresAt: z.string() }) })), 400: err, 503: err } });
  reg.registerPath({ method: "post", path: `${B}/{mediaId}/confirm`, tags: T, security, summary: "2) Confirm the upload: verifies size and real content type (magic bytes), extracts image dimensions; rejected files are deleted", request: { params: s.mediaParams }, responses: { 200: ok("Ready media", Media), 409: err, 422: err } });
  reg.registerPath({ method: "get", path: B, tags: T, security, summary: "Media library: filter by kind/status/filename, `unused=true` for deletable assets", request: { params: s.wsParam, query: s.listQuery }, responses: { 200: ok("Page", z.array(Media.extend({ usage_count: z.number() }))) } });
  reg.registerPath({ method: "get", path: `${B}/{mediaId}`, tags: T, security, summary: "Media details with a short-lived download URL", request: { params: s.mediaParams }, responses: { 200: ok("Media", Media.extend({ usage_count: z.number(), downloadUrl: z.string().nullable() })), 404: err } });
  reg.registerPath({ method: "get", path: `${B}/{mediaId}/compatibility`, tags: T, security, summary: "Per-platform compatibility of this file", request: { params: s.mediaParams }, responses: { 200: ok("Compatibility", z.record(z.string(), z.object({ compatible: z.boolean(), issues: z.array(z.record(z.string(), z.unknown())) }))) } });
  reg.registerPath({ method: "post", path: `${B}/{mediaId}/derivatives`, tags: T, security, summary: "Create a converted/resized copy of an image (e.g. JPEG for Instagram)", description: "Uses Cloudflare Images transformations; 503 IMAGE_TRANSFORM_UNAVAILABLE when not enabled for the deployment. The original is kept; the copy is a new asset verified like an upload.", request: { params: s.mediaParams, body: { content: { "application/json": { schema: s.derivativeBody } } } }, responses: { 201: ok("Derived asset", Media), 409: err, 502: err, 503: err } });
  reg.registerPath({ method: "delete", path: `${B}/{mediaId}`, tags: T, security, summary: "Delete an unused asset", request: { params: s.mediaParams }, responses: { 204: { description: "Deleted" }, 409: err } });
}
