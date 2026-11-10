import { z } from "zod";
import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";

const Check = z.object({ ok: z.boolean(), ms: z.number(), error: z.string().optional() });
const Ready = z.object({ data: z.object({ status: z.enum(["ok", "degraded"]), checks: z.object({ db: Check }) }) });

export function registerHealthDocs(reg: OpenAPIRegistry) {
  reg.registerPath({
    method: "get", path: "/health/live", tags: ["Health"], summary: "Liveness",
    responses: { 200: { description: "Process alive", content: { "application/json": { schema: z.object({ data: z.object({ status: z.literal("ok") }) }) } } } },
  });
  reg.registerPath({
    method: "get", path: "/health/ready", tags: ["Health"], summary: "Readiness (DB + Redis)",
    responses: {
      200: { description: "Ready", content: { "application/json": { schema: Ready } } },
      503: { description: "A dependency is down", content: { "application/json": { schema: Ready } } },
    },
  });
}
