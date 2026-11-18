import { z } from "zod";
import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { createTokenBody } from "./mcp.routes.js";

const err = { description: "Error", content: { "application/json": { schema: z.object({ error: z.object({ code: z.string(), message: z.string(), requestId: z.string() }) }) } } };
const ok = (description: string) => ({ description, content: { "application/json": { schema: z.object({ data: z.unknown() }) } } });
const security = [{ cookieAuth: [] }];
const params = z.object({ workspaceId: z.uuid() });

export function registerMcpDocs(reg: OpenAPIRegistry) {
  const tags = ["MCP"], p = "/workspaces/{workspaceId}/mcp/tokens";
  reg.registerPath({ method: "post", path: p, tags, security, summary: "Create a personal access token for MCP clients (owner/admin). The raw token is returned ONCE", request: { params, body: { content: { "application/json": { schema: createTokenBody } } } }, responses: { 201: ok("Token"), 400: err, 403: err, 404: err, 409: err } });
  reg.registerPath({ method: "get", path: p, tags, security, summary: "List MCP grants (admins see all, others their own); never returns secrets", request: { params }, responses: { 200: ok("Grants"), 404: err } });
  reg.registerPath({ method: "delete", path: `${p}/{grantId}`, tags, security, summary: "Revoke a grant and all its tokens", request: { params: params.extend({ grantId: z.uuid() }) }, responses: { 204: { description: "Revoked" }, 404: err } });

  // ---- Remote MCP endpoint and its OAuth surface (bearer tokens, not the cookie session)
  reg.registerComponent("securitySchemes", "mcpBearer", { type: "http", scheme: "bearer", description: "MCP access token: personal access token (dsp_), or a device/OAuth access token (dsa_)" });
  const bearer = [{ mcpBearer: [] }];
  const form = (shape: z.ZodRawShape) => ({ content: { "application/x-www-form-urlencoded": { schema: z.object(shape) } } });
  const json = (description: string) => ({ description, content: { "application/json": { schema: z.record(z.string(), z.unknown()) } } });
  reg.registerPath({ method: "post", path: "/mcp", tags, security: bearer, summary: "Model Context Protocol endpoint (Streamable HTTP, stateless, JSON responses). Tools, resources and prompts: see docs/mcp.md", responses: { 200: { description: "JSON-RPC response" }, 401: err, 403: err, 429: err } });
  reg.registerPath({ method: "get", path: "/.well-known/oauth-protected-resource/mcp", tags, summary: "RFC 9728 protected resource metadata", responses: { 200: json("Metadata") } });
  reg.registerPath({ method: "get", path: "/.well-known/oauth-authorization-server", tags, summary: "RFC 8414 authorization server metadata", responses: { 200: json("Metadata") } });
  reg.registerPath({ method: "post", path: "/mcp/register", tags, summary: "Dynamic client registration (RFC 7591): public clients, exact redirect URIs (https, loopback http or an app scheme)", request: { body: { content: { "application/json": { schema: z.object({ client_name: z.string().max(80), redirect_uris: z.array(z.string()).min(1).max(5) }) } } } }, responses: { 201: json("Registered client"), 400: json("invalid_redirect_uri"), 429: err } });
  reg.registerPath({ method: "get", path: "/mcp/authorize", tags, security, summary: "OAuth consent page (authorization code + PKCE S256). Needs a signed-in browser; owner/admin workspaces only", request: { query: z.object({ client_id: z.string(), redirect_uri: z.string(), response_type: z.literal("code"), code_challenge: z.string(), code_challenge_method: z.literal("S256"), scope: z.string().optional(), state: z.string().optional() }) }, responses: { 200: { description: "HTML consent page" }, 400: { description: "HTML error page" }, 401: err } });
  reg.registerPath({ method: "post", path: "/mcp/authorize", tags, security, summary: "OAuth consent decision (form post). Answers an HTML page that returns the browser to the client with a single-use code (60 s) or error=access_denied", request: { body: form({ client_id: z.string(), redirect_uri: z.string(), code_challenge: z.string(), code_challenge_method: z.literal("S256"), workspace_id: z.uuid(), decision: z.enum(["approve", "deny"]) }) }, responses: { 200: { description: "HTML" }, 400: { description: "HTML" }, 403: err } });
  reg.registerPath({ method: "post", path: "/mcp/token", tags, summary: "Token endpoint: authorization_code (PKCE), refresh_token (rotating) and device_code grants", request: { body: form({ grant_type: z.string(), code: z.string().optional(), code_verifier: z.string().optional(), client_id: z.string().optional(), redirect_uri: z.string().optional(), refresh_token: z.string().optional(), device_code: z.string().optional() }) }, responses: { 200: json("access_token, refresh_token, token_type, expires_in, scope, workspace_id"), 400: json("OAuth error (invalid_grant, authorization_pending, slow_down, ...)"), 429: err } });
  reg.registerPath({ method: "post", path: "/mcp/device", tags, summary: "Device authorization (RFC 8628) for the CLI", request: { body: { content: { "application/json": { schema: z.object({ client_name: z.string().optional(), scopes: z.array(z.string()).optional() }) } } } }, responses: { 200: json("device_code, user_code, verification_uri, expires_in, interval"), 429: err } });
  reg.registerPath({ method: "get", path: "/mcp/device", tags, security, summary: "Device approval page (needs a signed-in browser)", request: { query: z.object({ user_code: z.string().optional() }) }, responses: { 200: { description: "HTML" }, 401: err } });
  reg.registerPath({ method: "post", path: "/mcp/device/approve", tags, security, summary: "Device approval decision (form post; owner/admin)", request: { body: form({ user_code: z.string(), workspace_id: z.uuid(), decision: z.enum(["approve", "deny"]) }) }, responses: { 200: { description: "HTML" }, 403: err, 404: err } });
}
