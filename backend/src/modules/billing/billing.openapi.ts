import { z } from "zod";
import { checkoutBody } from "./billing.routes.js";
import { newVersionBody } from "./billing.admin.js";
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

  // ---- Provider webhook and operator admin (not user-session endpoints)
  reg.registerComponent("securitySchemes", "opsBearer", { type: "http", scheme: "bearer", description: "OPS_TOKEN (operators only; the routes answer 404 when OPS_TOKEN is not configured)" });
  const ops = [{ opsBearer: [] }], A = ["Billing admin"];
  const rows = (d: string) => ({ description: d, content: { "application/json": { schema: z.object({ data: z.unknown() }) } } });
  reg.registerPath({ method: "post", path: "/webhooks/dodo", tags, summary: "Dodo Payments webhook (Standard Webhooks signature over the raw body; stored once, applied after re-reading the subscription from the provider)", responses: { 200: { description: "Accepted (or duplicate)" }, 401: err } });
  reg.registerPath({ method: "get", path: "/admin/billing/summary", tags: A, security: ops, summary: "Subscribers per plan/status, MRR per currency (minor units), webhook health (7 days). Aggregates only", responses: { 200: rows("Summary"), 401: err } });
  reg.registerPath({ method: "get", path: "/admin/billing/webhook-events", tags: A, security: ops, summary: "Webhook events by status (failed by default)", request: { query: z.object({ status: z.enum(["received", "failed", "processed", "ignored"]).optional(), limit: z.number().int().min(1).max(100).optional() }) }, responses: { 200: rows("Events"), 401: err } });
  reg.registerPath({ method: "post", path: "/admin/billing/webhook-events/{id}/retry", tags: A, security: ops, summary: "Re-queue a failed, received or ignored webhook event and process due events now", request: { params: z.object({ id: z.uuid() }) }, responses: { 200: rows("Sweep result"), 401: err, 404: err } });
  reg.registerPath({ method: "post", path: "/admin/billing/plans/{plan}/versions", tags: A, security: ops, summary: "Publish a new immutable plan version (prices in integer minor units + entitlements); existing subscribers keep their version", request: { params: z.object({ plan: z.string() }), body: { content: { "application/json": { schema: newVersionBody } } } }, responses: { 201: rows("Published"), 400: err, 401: err, 404: err } });
  reg.registerPath({ method: "put", path: "/admin/billing/plans/{plan}/prices/{currency}/{interval}/provider-ref", tags: A, security: ops, summary: "Map a plan price to the provider's product id", request: { params: z.object({ plan: z.string(), currency: z.enum(["INR", "USD"]), interval: z.enum(["month", "year"]) }), body: { content: { "application/json": { schema: z.object({ provider: z.string(), ref: z.string() }) } } } }, responses: { 200: rows("Mapped"), 401: err, 404: err } });
}
