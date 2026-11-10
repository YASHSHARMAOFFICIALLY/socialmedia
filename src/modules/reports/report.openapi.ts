import { z } from "zod";
import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { createBody, idParam, listQuery, wsParam } from "./report.routes.js";
const err = { description: "Error", content: { "application/json": { schema: z.object({ error: z.object({ code: z.string(), message: z.string(), requestId: z.string() }) }) } } };
const ok = (description: string) => ({ description, content: { "application/json": { schema: z.object({ data: z.unknown(), meta: z.object({ nextCursor: z.string().nullable() }).optional() }) } } });
const security = [{ cookieAuth: [] }];
export function registerReportDocs(reg: OpenAPIRegistry) {
  const T = ["Reports"], B = "/workspaces/{workspaceId}/reports";
  reg.registerPath({ method: "post", path: B, tags: T, security, summary: "Request a CSV or PDF export (asynchronous)", description: "Types: post_performance, account_performance, campaign_analytics, platform_comparison, historical_performance. Produced by the background sweep (typically within a minute). Empty cells mean the value is unavailable, never zero. `format` is `csv` (default, up to 50,000 rows) or `pdf` (up to 3,000 rows, Latin-1 text, long cells truncated).", request: { params: wsParam, body: { content: { "application/json": { schema: createBody } } } }, responses: { 202: ok("Queued"), 400: err, 403: err } });
  reg.registerPath({ method: "get", path: B, tags: T, security, summary: "List exports", request: { params: wsParam, query: listQuery }, responses: { 200: ok("Page") } });
  reg.registerPath({ method: "get", path: `${B}/{reportId}`, tags: T, security, summary: "Export status: queued | running | done | failed", request: { params: idParam }, responses: { 200: ok("Status"), 404: err } });
  reg.registerPath({ method: "get", path: `${B}/{reportId}/download`, tags: T, security, summary: "Download the CSV (409 until ready, 410 after the 7-day retention)", request: { params: idParam }, responses: { 200: { description: "The file", content: { "text/csv": { schema: z.string() }, "application/pdf": { schema: z.string() } } }, 409: err, 410: err } });
}
