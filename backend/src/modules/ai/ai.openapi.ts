import { z } from "zod";
import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { adaptBody, postParams, suggestBody, wsParam } from "./ai.routes.js";
const err = { description: "Error", content: { "application/json": { schema: z.object({ error: z.object({ code: z.string(), message: z.string(), requestId: z.string() }) }) } } };
const ok = (d: string) => ({ description: d, content: { "application/json": { schema: z.object({ data: z.unknown() }) } } });
const security = [{ cookieAuth: [] }];
export function registerAiDocs(reg: OpenAPIRegistry) {
  const T = ["AI assistance (optional)"];
  reg.registerPath({ method: "get", path: "/workspaces/{workspaceId}/ai", tags: T, security, summary: "Is an AI provider configured, and what happens without one", request: { params: wsParam }, responses: { 200: ok("Status") } });
  reg.registerPath({ method: "post", path: "/workspaces/{workspaceId}/posts/{postId}/adapt", tags: T, security, summary: "Suggest a platform-specific version of the post for each destination (NOT saved)", description: "With a provider configured the model rewrites the draft for each platform; otherwise deterministic rules fit the text to platform limits. Every suggestion is validated against the platform rules and returned with its issues. Apply a suggestion by editing it and sending it to PUT /posts/{id}/variants/{accountId}: AI output is never published without a human step. Post text is sent to the configured AI provider.", request: { params: postParams, body: { content: { "application/json": { schema: adaptBody } } } }, responses: { 200: ok("Suggestions"), 400: err, 429: err, 502: err } });
  reg.registerPath({ method: "post", path: "/workspaces/{workspaceId}/ai/suggestions", tags: T, security, summary: "Alternative captions / titles / hashtags / audience rewrites for a piece of text (requires a provider: 503 AI_NOT_CONFIGURED otherwise)", request: { params: wsParam, body: { content: { "application/json": { schema: suggestBody } } } }, responses: { 200: ok("Suggestions"), 429: err, 503: err } });
}
