import { z } from "zod";
import { checkoutBody } from "./billing.routes.js";
import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";

const err = { description: "Error", content: { "application/json": { schema: z.object({ error: z.object({ code: z.string(), message: z.string(), requestId: z.string() }) }) } } };
const ok = (description: string) => ({ description, content: { "application/json": { schema: z.object({ data: z.unknown() }) } } });
const security = [{ cookieAuth: [] }];
const wsParam = z.object({ workspaceId: z.uuid() });

export function registerBillingDocs(reg: OpenAPIRegistry) {
  const tags = ["Billing"];
  reg.registerPath({ method: "get", path: "/billing/plans", tags, security, summary: "Plan catalog: active plan versions, prices in integer minor units (paise/cents), entitlements", responses: { 200: ok("Plans"), 401: err } });
  reg.registerPath({ method: "get", path: "/workspaces/{workspaceId}/billing", tags, security, summary: "Workspace plan, subscription state and per-feature usage (owner/admin)", request: { params: wsParam }, responses: { 200: ok("Billing overview"), 403: err, 404: err } });
  reg.registerPath({ method: "post", path: "/workspaces/{workspaceId}/billing/checkout", tags, security, summary: "Start a hosted checkout for a plan (owner). Returns the provider's checkout URL; the plan is granted only after the provider confirms payment via webhook", request: { params: wsParam, body: { content: { "application/json": { schema: checkoutBody } } } }, responses: { 201: ok("Checkout started"), 400: err, 403: err, 404: err, 409: err, 502: err, 503: err } });
  reg.registerPath({ method: "get", path: "/workspaces/{workspaceId}/billing/payments", tags, security, summary: "Payments recorded for the workspace (integer minor units), newest first (owner/admin)", request: { params: wsParam, query: z.object({ limit: z.number().int().min(1).max(100).optional() }) }, responses: { 200: ok("Payments"), 403: err, 404: err } });
  reg.registerPath({ method: "post", path: "/workspaces/{workspaceId}/billing/portal", tags, security, summary: "Create a provider-hosted billing portal link (owner). Created on demand, never stored", request: { params: wsParam }, responses: { 201: ok("Portal link"), 403: err, 404: err, 409: err, 502: err, 503: err } });
  reg.registerPath({ method: "post", path: "/workspaces/{workspaceId}/billing/cancel", tags, security, summary: "Cancel the subscription at the end of the current period (owner)", request: { params: wsParam }, responses: { 200: ok("Cancellation scheduled"), 403: err, 404: err, 409: err, 502: err, 503: err } });
}
