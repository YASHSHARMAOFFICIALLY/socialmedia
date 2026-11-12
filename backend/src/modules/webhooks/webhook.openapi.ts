import { z } from "zod";
import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import * as s from "./webhook.schemas.js";
const err = { description: "Error", content: { "application/json": { schema: z.object({ error: z.object({ code: z.string(), message: z.string(), requestId: z.string() }) }) } } };
const ok = (d: string) => ({ description: d, content: { "application/json": { schema: z.object({ data: z.unknown(), meta: z.unknown().optional() }) } } });
const security = [{ cookieAuth: [] }];
export function registerWebhookDocs(reg: OpenAPIRegistry) {
  const T = ["Webhooks"], B = "/workspaces/{workspaceId}/webhooks";
  reg.registerPath({ method: "post", path: B, tags: T, security, summary: "Create an outbound webhook endpoint (owner/admin). The signing secret is returned ONCE.", description: "Deliveries are POSTed as JSON `{ type, workspaceId, data }` with headers `X-Webhook-Id`, `X-Webhook-Event`, `X-Webhook-Timestamp` and `X-Webhook-Signature: t=<unix>,v1=<hex>` where v1 = HMAC-SHA256(secret, \"<t>.<raw body>\"). Reject deliveries whose timestamp is older than a few minutes. Retries: 1m, 5m, 30m, 2h, 6h, 12h, 24h; HTTP 410 or 5 consecutive failed deliveries disable the endpoint. https only; redirects are not followed.", request: { params: s.wsParam, body: { content: { "application/json": { schema: s.createBody } } } }, responses: { 201: ok("Created (with secret)"), 400: err } });
  reg.registerPath({ method: "get", path: B, tags: T, security, summary: "List endpoints and the supported event types", request: { params: s.wsParam }, responses: { 200: ok("Endpoints") } });
  reg.registerPath({ method: "patch", path: `${B}/{webhookId}`, tags: T, security, summary: "Update URL / events; re-enable an auto-disabled endpoint with enabled=true", request: { params: s.idParam, body: { content: { "application/json": { schema: s.updateBody } } } }, responses: { 200: ok("Endpoint"), 404: err } });
  reg.registerPath({ method: "delete", path: `${B}/{webhookId}`, tags: T, security, summary: "Delete an endpoint", request: { params: s.idParam }, responses: { 204: { description: "Deleted" } } });
  reg.registerPath({ method: "post", path: `${B}/{webhookId}/rotate-secret`, tags: T, security, summary: "Rotate the signing secret (returned once)", request: { params: s.idParam }, responses: { 200: ok("New secret") } });
  reg.registerPath({ method: "post", path: `${B}/{webhookId}/ping`, tags: T, security, summary: "Queue a test `ping` delivery", request: { params: s.idParam }, responses: { 202: ok("Queued") } });
  reg.registerPath({ method: "get", path: `${B}/{webhookId}/deliveries`, tags: T, security, summary: "Delivery log", request: { params: s.idParam, query: s.deliveriesQuery }, responses: { 200: ok("Page") } });
  const P = ["Platform webhooks (inbound)"];
  reg.registerPath({ method: "get", path: "/webhooks/instagram", tags: P, summary: "Meta verification handshake (echoes hub.challenge when hub.verify_token matches INSTAGRAM_WEBHOOK_VERIFY_TOKEN)", responses: { 200: { description: "Challenge" }, 403: err } });
  reg.registerPath({ method: "post", path: "/webhooks/instagram", tags: P, summary: "Instagram event delivery. Requires a valid X-Hub-Signature-256 (HMAC of the raw body with the app secret); deduplicated and stored", responses: { 200: { description: "Received" }, 401: err } });
  reg.registerPath({ method: "post", path: "/webhooks/instagram/deauthorize", tags: P, summary: "Meta deauthorize callback (signed_request): disconnects the account and deletes its tokens", responses: { 200: { description: "OK" }, 400: err } });
  reg.registerPath({ method: "post", path: "/webhooks/instagram/data-deletion", tags: P, summary: "Meta data deletion callback (signed_request): disconnects, deletes tokens and collected analytics; returns { url, confirmation_code }", responses: { 200: { description: "Confirmation" }, 400: err } });
  reg.registerPath({ method: "get", path: "/webhooks/data-deletion/{code}", tags: P, summary: "Status page for a data deletion request", request: { params: z.object({ code: z.string() }) }, responses: { 200: ok("Status"), 404: err } });
}
