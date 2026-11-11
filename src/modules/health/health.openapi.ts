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
  reg.registerPath({ method: "get", path: "/health/workers", tags: ["Health"], summary: "Informational: last heartbeat of the scheduled and queue handlers", responses: { 200: { description: "Worker status" }, 503: { description: "Database unreachable" } } });
  reg.registerPath({ method: "get", path: "/health/queues", tags: ["Health"], summary: "Queue/outbox depth for external monitoring (needs the OPS_TOKEN bearer; 404 when OPS_TOKEN is not configured)", responses: { 200: { description: "Depths" }, 401: { description: "Bad token" }, 404: { description: "Disabled" } } });
}
