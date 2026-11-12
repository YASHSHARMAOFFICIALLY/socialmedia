import { z } from "zod";
import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { addBody, compareQuery, idParam, rangeQuery, wsParam } from "./competitor.routes.js";
const err = { description: "Error", content: { "application/json": { schema: z.object({ error: z.object({ code: z.string(), message: z.string(), requestId: z.string() }) }) } } };
const ok = (d: string) => ({ description: d, content: { "application/json": { schema: z.object({ data: z.unknown() }) } } });
const security = [{ cookieAuth: [] }];
export function registerCompetitorDocs(reg: OpenAPIRegistry) {
  const T = ["Competitors"], B = "/workspaces/{workspaceId}/competitors";
  reg.registerPath({ method: "post", path: B, tags: T, security, summary: "Track a public competitor account (X username or YouTube channel URL/@handle/id)", description: "PUBLIC data only, read through the official API with one of your own connected accounts on that platform. Supported: X, YouTube. Instagram (Business Discovery needs Facebook Login) and LinkedIn do not expose this to the integrations used here: 422 CAPABILITY_UNSUPPORTED. Private analytics of competitors are never available.", request: { params: wsParam, body: { content: { "application/json": { schema: addBody } } } }, responses: { 201: ok("Tracked"), 404: err, 409: err, 422: err } });
  reg.registerPath({ method: "get", path: B, tags: T, security, summary: "Tracked competitors", request: { params: wsParam }, responses: { 200: ok("List") } });
  reg.registerPath({ method: "get", path: `${B}/compare`, tags: T, security, summary: "You vs competitors on one platform, on publicly visible metrics only", request: { params: wsParam, query: compareQuery }, responses: { 200: ok("Comparison") } });
  reg.registerPath({ method: "get", path: `${B}/{competitorId}`, tags: T, security, summary: "Competitor profile, follower change, posting frequency, public engagement per post", request: { params: idParam, query: rangeQuery }, responses: { 200: ok("Competitor"), 404: err } });
  reg.registerPath({ method: "delete", path: `${B}/{competitorId}`, tags: T, security, summary: "Stop tracking (deletes collected data)", request: { params: idParam }, responses: { 204: { description: "Deleted" } } });
}
