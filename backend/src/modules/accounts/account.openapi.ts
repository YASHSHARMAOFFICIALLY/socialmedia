import { z } from "zod";
import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { pageQuery } from "../../shared/utils/pagination.js";
import * as s from "./account.schemas.js";

const err = { description: "Error", content: { "application/json": { schema: z.object({ error: z.object({ code: z.string(), message: z.string(), requestId: z.string() }) }) } } };
const ok = (description: string, schema: z.ZodType) => ({ description, content: { "application/json": { schema: z.object({ data: schema, meta: z.object({ nextCursor: z.string().nullable() }).optional() }) } } });
const security = [{ cookieAuth: [] }];
// Credentials are intentionally absent from every schema: tokens are never returned by any endpoint.
const Account = z.object({ id: z.uuid(), platform: z.string(), external_id: z.string(), display_name: z.string(), username: z.string().nullable(), avatar_url: z.string().nullable(), account_type: z.string(), status: z.enum(["active", "needs_reauth", "disconnected"]), last_error: z.string().nullable() });

export function registerAccountDocs(reg: OpenAPIRegistry) {
  const T = ["Social accounts"];
  reg.registerPath({ method: "get", path: "/platforms", tags: T, security, summary: "Platform availability and verified capabilities", responses: { 200: ok("Platforms", z.array(z.object({ platform: z.string(), available: z.boolean(), capabilities: z.record(z.string(), z.boolean()).nullable(), connect: z.enum(["oauth", "credentials"]).nullable(), fields: z.array(z.object({ name: z.string(), label: z.string(), secret: z.boolean(), help: z.string().optional() })).optional() }))) } });
  reg.registerPath({ method: "post", path: "/workspaces/{workspaceId}/accounts/connect", tags: T, security, summary: "Start OAuth: returns the platform authorization URL", request: { params: s.wsParam, body: { content: { "application/json": { schema: s.connectBody } } } }, responses: { 200: ok("URL", z.object({ authorizationUrl: z.string() })), 400: err, 403: err } });
  reg.registerPath({ method: "post", path: "/workspaces/{workspaceId}/accounts/connect-credentials", tags: T, security, summary: "Connect a platform that uses credentials instead of OAuth (see /platforms fields)", request: { params: s.wsParam, body: { content: { "application/json": { schema: s.credentialsBody } } } }, responses: { 201: ok("Connected account", Account), 400: err, 403: err } });
  reg.registerPath({ method: "get", path: "/oauth/{platform}/callback", tags: T, summary: "OAuth callback (browser redirect from the platform; validated by single-use state)", request: { params: s.callbackParams, query: s.callbackQuery }, responses: { 302: { description: "Redirect to APP_URL" }, 200: ok("Connected account (when APP_URL unset)", Account), 400: err } });
  reg.registerPath({ method: "get", path: "/workspaces/{workspaceId}/accounts", tags: T, security, summary: "List connected accounts", request: { params: s.wsParam, query: pageQuery }, responses: { 200: ok("Page", z.array(Account)) } });
  reg.registerPath({ method: "get", path: "/workspaces/{workspaceId}/accounts/{accountId}", tags: T, security, summary: "Get account with granted permissions", request: { params: s.accountParams }, responses: { 200: ok("Account", Account), 404: err } });
  reg.registerPath({ method: "delete", path: "/workspaces/{workspaceId}/accounts/{accountId}", tags: T, security, summary: "Disconnect account (deletes stored tokens)", request: { params: s.accountParams }, responses: { 204: { description: "Disconnected" }, 404: err } });
  reg.registerPath({ method: "post", path: "/workspaces/{workspaceId}/accounts/{accountId}/refresh", tags: T, security, summary: "Refresh connection (token refresh, or a re-authorization URL when the platform cannot refresh)", request: { params: s.accountParams }, responses: { 200: ok("Result", z.object({ status: z.enum(["ok", "reauthorization_required"]), authorizationUrl: z.string().optional() })), 404: err } });
}
