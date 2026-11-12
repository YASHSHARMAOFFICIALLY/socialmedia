import { z } from "zod";
import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import * as s from "./notification.schemas.js";
const err = { description: "Error", content: { "application/json": { schema: z.object({ error: z.object({ code: z.string(), message: z.string(), requestId: z.string() }) }) } } };
const ok = (description: string) => ({ description, content: { "application/json": { schema: z.object({ data: z.unknown(), meta: z.object({ nextCursor: z.string().nullable(), unread: z.number() }).partial().optional() }) } } });
const security = [{ cookieAuth: [] }];
export function registerNotificationDocs(reg: OpenAPIRegistry) {
  const T = ["Notifications"], B = "/workspaces/{workspaceId}/notifications";
  reg.registerPath({ method: "get", path: B, tags: T, security, summary: "My notifications (newest first; `unread=true` to filter); meta.unread = unread count", request: { params: s.wsParam, query: s.listQuery }, responses: { 200: ok("Page") } });
  reg.registerPath({ method: "post", path: `${B}/read-all`, tags: T, security, summary: "Mark all as read", request: { params: s.wsParam }, responses: { 200: ok("Updated") } });
  reg.registerPath({ method: "post", path: `${B}/{notificationId}/read`, tags: T, security, summary: "Mark one as read", request: { params: s.idParam }, responses: { 204: { description: "Done" }, 404: err } });
  reg.registerPath({ method: "get", path: "/workspaces/{workspaceId}/notification-preferences", tags: T, security, summary: "In-app / email preferences per notification type", request: { params: s.wsParam }, responses: { 200: ok("Preferences") } });
  reg.registerPath({ method: "put", path: "/workspaces/{workspaceId}/notification-preferences", tags: T, security, summary: "Update preferences", request: { params: s.wsParam, body: { content: { "application/json": { schema: s.prefsBody } } } }, responses: { 200: ok("Preferences"), 400: err } });
}
