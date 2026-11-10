import { z } from "zod";
import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { insightsQuery, wsParam } from "./insights.routes.js";
const ok = (description: string) => ({ description, content: { "application/json": { schema: z.object({ data: z.record(z.string(), z.unknown()) }) } } });
const security = [{ cookieAuth: [] }];
export function registerInsightDocs(reg: OpenAPIRegistry) {
  reg.registerPath({ method: "get", path: "/workspaces/{workspaceId}/insights", tags: ["Insights"], security, summary: "Evidence-based insights", description: "Deterministic rules over collected analytics (no LLM). Every insight carries its evidence (date range, sample sizes, medians). When data is insufficient the rule appears under `skipped` with the reason instead of guessing. Best posting time needs 20+ posts per platform.", request: { params: wsParam, query: insightsQuery }, responses: { 200: ok("Insights") } });
  reg.registerPath({ method: "get", path: "/workspaces/{workspaceId}/insights/recommendations", tags: ["Insights"], security, summary: "Performance recommendations derived only from insights that met their evidence thresholds", request: { params: wsParam, query: insightsQuery }, responses: { 200: ok("Recommendations") } });
}
