import { z } from "zod";
import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import * as s from "./analytics.schemas.js";

const err = { description: "Error", content: { "application/json": { schema: z.object({ error: z.object({ code: z.string(), message: z.string(), requestId: z.string() }) }) } } };
const ok = (description: string) => ({ description, content: { "application/json": { schema: z.object({ data: z.record(z.string(), z.unknown()) }) } } });
const security = [{ cookieAuth: [] }];

export function registerAnalyticsDocs(reg: OpenAPIRegistry) {
  const T = ["Analytics"], B = "/workspaces/{workspaceId}/analytics";
  const get = (path: string, summary: string, request: object, description?: string) => reg.registerPath({ method: "get", path: `${B}${path}`, tags: T, security, summary, ...(description ? { description } : {}), request: request as never, responses: { 200: ok("OK"), 400: err, 404: err } });
  reg.registerPath({ method: "get", path: `${B}/metrics`, tags: T, security, summary: "Canonical metric vocabulary and which metrics may be summed across platforms", request: { params: s.wsParam }, responses: { 200: ok("Definitions") } });
  get("/sync-status", "Data freshness per platform: last collection time, active/failing/disabled targets, supported analytics", { params: s.wsParam }, "Not cached. Use it to tell whether numbers are stale or collection is failing.");
  get("/overview", "Cross-platform dashboard (default: last 30 days)", { params: s.wsParam, query: s.overviewQuery },
    "Per-platform metrics, derived interactions, engagement rate (with its denominator), follower level and change. `totals` contains ONLY metrics flagged comparable (likes, comments, followers, interactions), each with the per-platform values and a caveat. Everything else is per platform only. A metric with value null is UNAVAILABLE (the platform returned nothing) — it is never reported as 0; `postsReporting` / `postsUnavailable` / `notYetCollected` explain coverage.");
  get("/platforms/{platform}", "Platform analytics with interaction trend and top posts", { params: s.platformParams, query: s.grainQuery });
  get("/accounts/{accountId}", "Account analytics: followers growth, post summary, top posts", { params: s.accountParams, query: s.grainQuery });
  get("/posts/{postId}", "Post analytics per destination: every metric with availability (available/unavailable), history, engagement rate; state unsupported/not_yet_collected/collected", { params: s.postParams, query: s.postQuery });
  get("/trends", "Time series (day/week/month): gained-in-bucket for post metrics, level for followers; `combined` only for comparable metrics", { params: s.wsParam, query: s.trendsQuery });
  get("/compare/platforms", "Platforms side by side", { params: s.wsParam, query: s.rangeQuery });
  get("/compare/ranges", "Two date ranges side by side (change is null when either side has no data)", { params: s.wsParam, query: s.compareRangesQuery });
  get("/top-posts", "Top posts by metric. Ranking across platforms is only allowed for comparable metrics (else 400 METRIC_NOT_COMPARABLE)", { params: s.wsParam, query: s.topQuery });
}
