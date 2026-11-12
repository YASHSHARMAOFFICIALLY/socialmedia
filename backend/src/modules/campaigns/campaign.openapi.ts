import { z } from "zod";
import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import * as s from "./campaign.schemas.js";

const err = { description: "Error", content: { "application/json": { schema: z.object({ error: z.object({ code: z.string(), message: z.string(), requestId: z.string() }) }) } } };
const ok = (description: string) => ({ description, content: { "application/json": { schema: z.object({ data: z.record(z.string(), z.unknown()), meta: z.object({ nextCursor: z.string().nullable() }).optional() }) } } });
const body = (schema: z.ZodType) => ({ content: { "application/json": { schema } } });
const security = [{ cookieAuth: [] }];

export function registerCampaignDocs(reg: OpenAPIRegistry) {
  const T = ["Campaigns"], B = "/workspaces/{workspaceId}/campaigns";
  reg.registerPath({ method: "post", path: B, tags: T, security, summary: "Create a campaign", request: { params: s.wsParam, body: body(s.createBody) }, responses: { 201: ok("Created"), 400: err } });
  reg.registerPath({ method: "get", path: B, tags: T, security, summary: "List campaigns", request: { params: s.wsParam, query: s.listQuery }, responses: { 200: ok("Page") } });
  reg.registerPath({ method: "get", path: `${B}/compare`, tags: T, security, summary: "Compare 2-5 campaigns (per-platform values; totals only for comparable metrics)", request: { params: s.wsParam, query: s.compareQuery }, responses: { 200: ok("Comparison"), 404: err } });
  reg.registerPath({ method: "get", path: `${B}/{campaignId}`, tags: T, security, summary: "Campaign with posts and publishing status per platform", request: { params: s.campaignParams }, responses: { 200: ok("Campaign"), 404: err } });
  reg.registerPath({ method: "patch", path: `${B}/{campaignId}`, tags: T, security, summary: "Update / archive a campaign", request: { params: s.campaignParams, body: body(s.updateBody) }, responses: { 200: ok("Campaign"), 400: err } });
  reg.registerPath({ method: "post", path: `${B}/{campaignId}/posts`, tags: T, security, summary: "Add posts (a post belongs to at most one campaign; posts moved from another campaign are reported)", request: { params: s.campaignParams, body: body(s.addPostsBody) }, responses: { 200: ok("Result"), 400: err } });
  reg.registerPath({ method: "delete", path: `${B}/{campaignId}/posts/{postId}`, tags: T, security, summary: "Remove a post from the campaign", request: { params: s.campaignPostParams }, responses: { 204: { description: "Removed" }, 404: err } });
  reg.registerPath({ method: "get", path: `${B}/{campaignId}/performance`, tags: T, security, summary: "Campaign analytics: platform contribution, comparable totals, interactions trend, publishing status", request: { params: s.campaignParams, query: s.performanceQuery }, responses: { 200: ok("Performance"), 404: err } });
}
