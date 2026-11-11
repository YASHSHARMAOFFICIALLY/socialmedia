import { z } from "zod";
import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import * as s from "./workspace.schemas.js";
import { pageQuery } from "../../shared/utils/pagination.js";

const err = { description: "Error", content: { "application/json": { schema: z.object({ error: z.object({ code: z.string(), message: z.string(), requestId: z.string() }) }) } } };
const ok = (description: string, schema: z.ZodType) => ({ description, content: { "application/json": { schema: z.object({ data: schema, meta: z.object({ nextCursor: z.string().nullable() }).optional() }) } } });
const json = (schema: z.ZodType) => ({ content: { "application/json": { schema } } });
const security = [{ cookieAuth: [] }];

const Workspace = z.object({ id: z.uuid(), name: z.string(), kind: s.workspaceKind, created_at: z.string(), updated_at: z.string() });
const Member = z.object({ user_id: z.string(), email: z.string(), name: z.string(), role: z.string(), created_at: z.string() });
const Invitation = z.object({ id: z.uuid(), workspace_id: z.uuid(), email: z.string(), role: z.string(), expires_at: z.string(), created_at: z.string() });

export function registerAuthDocs(reg: OpenAPIRegistry) {
  reg.registerComponent("securitySchemes", "cookieAuth", { type: "apiKey", in: "cookie", name: "better-auth.session_token" });
  const creds = z.object({ email: z.email(), password: z.string().min(10) });
  const paths: [string, string, string, z.ZodType | undefined][] = [
    ["post", "/api/auth/sign-up/email", "Register (email + password)", creds.extend({ name: z.string() })],
    ["post", "/api/auth/sign-in/email", "Login", creds],
    ["post", "/api/auth/sign-out", "Logout", undefined],
    ["get", "/api/auth/get-session", "Current session", undefined],
    ["get", "/api/auth/list-sessions", "List active sessions", undefined],
    ["post", "/api/auth/revoke-session", "Revoke one session", z.object({ token: z.string() })],
    ["post", "/api/auth/revoke-other-sessions", "Revoke all other sessions", undefined],
    ["post", "/api/auth/change-password", "Change password", z.object({ currentPassword: z.string(), newPassword: z.string(), revokeOtherSessions: z.boolean().optional() })],
    ["post", "/api/auth/request-password-reset", "Request password reset email", z.object({ email: z.email(), redirectTo: z.string().optional() })],
    ["post", "/api/auth/reset-password", "Complete password reset", z.object({ newPassword: z.string(), token: z.string() })],
  ];
  for (const [method, path, summary, body] of paths) {
    reg.registerPath({ method: method as "get" | "post", path, tags: ["Auth (Better Auth)"], summary, request: body ? { body: json(body) } : {}, responses: { 200: { description: "OK" }, 400: err, 401: err } });
  }
}

export function registerWorkspaceDocs(reg: OpenAPIRegistry) {
  const T = ["Workspaces"];
  const wsId = { params: s.idParam };
  reg.registerPath({ method: "post", path: "/workspaces", tags: T, security, summary: "Create workspace (caller becomes owner)", request: { body: json(s.createWorkspaceBody) }, responses: { 201: ok("Created", Workspace), 400: err, 401: err } });
  reg.registerPath({ method: "get", path: "/workspaces", tags: T, security, summary: "List my workspaces", request: { query: pageQuery }, responses: { 200: ok("Page", z.array(Workspace)), 401: err } });
  reg.registerPath({ method: "get", path: "/workspaces/{workspaceId}", tags: T, security, summary: "Get workspace", request: wsId, responses: { 200: ok("Workspace", Workspace), 404: err } });
  reg.registerPath({ method: "delete", path: "/me", tags: T, security, summary: "Erase your account: anonymizes your identity and removes logins, sessions, memberships and MCP grants. Sole owners of a workspace must transfer or delete it first (409 OWNS_WORKSPACES)", request: { body: json(z.object({ confirmEmail: z.string() })) }, responses: { 204: { description: "Erased" }, 400: err, 409: err } });
  reg.registerPath({ method: "delete", path: "/workspaces/{workspaceId}", tags: T, security, summary: "Permanently delete the workspace and all its data (owner only; send the exact workspace name; cancel any paid subscription first)", request: { ...wsId, body: json(s.deleteWorkspaceBody) }, responses: { 204: { description: "Deleted" }, 400: err, 403: err, 404: err, 409: err } });
  reg.registerPath({ method: "patch", path: "/workspaces/{workspaceId}", tags: T, security, summary: "Update workspace", request: { ...wsId, body: json(s.updateWorkspaceBody) }, responses: { 200: ok("Updated", Workspace), 403: err, 404: err } });
  reg.registerPath({ method: "get", path: "/workspaces/{workspaceId}/members", tags: T, security, summary: "List members", request: wsId, responses: { 200: ok("Members", z.array(Member)), 404: err } });
  reg.registerPath({ method: "patch", path: "/workspaces/{workspaceId}/members/{userId}", tags: T, security, summary: "Change member role", request: { params: s.memberParams, body: json(s.roleBody) }, responses: { 200: ok("Updated", z.object({ userId: z.string(), role: z.string() })), 403: err, 409: err } });
  reg.registerPath({ method: "delete", path: "/workspaces/{workspaceId}/members/{userId}", tags: T, security, summary: "Remove member (or leave)", request: { params: s.memberParams }, responses: { 204: { description: "Removed" }, 403: err, 409: err } });
  reg.registerPath({ method: "post", path: "/workspaces/{workspaceId}/invitations", tags: T, security, summary: "Invite by email", request: { ...wsId, body: json(s.inviteBody) }, responses: { 201: ok("Invited", Invitation), 403: err, 409: err } });
  reg.registerPath({ method: "get", path: "/workspaces/{workspaceId}/invitations", tags: T, security, summary: "List open invitations", request: wsId, responses: { 200: ok("Invitations", z.array(Invitation)), 403: err } });
  reg.registerPath({ method: "delete", path: "/workspaces/{workspaceId}/invitations/{invitationId}", tags: T, security, summary: "Revoke invitation", request: { params: s.invitationParams }, responses: { 204: { description: "Revoked" }, 404: err } });
  reg.registerPath({ method: "post", path: "/invitations/accept", tags: T, security, summary: "Accept invitation (email must match)", request: { body: json(s.acceptBody) }, responses: { 200: ok("Joined", z.object({ workspaceId: z.uuid(), role: z.string() })), 400: err, 403: err } });
  reg.registerPath({ method: "get", path: "/workspaces/{workspaceId}/audit-logs", tags: T, security, summary: "Audit log (newest first)", request: { ...wsId, query: pageQuery }, responses: { 200: ok("Page", z.array(z.record(z.string(), z.unknown()))), 403: err } });
}
