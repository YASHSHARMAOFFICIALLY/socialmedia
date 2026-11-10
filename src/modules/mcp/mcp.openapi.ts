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
}
