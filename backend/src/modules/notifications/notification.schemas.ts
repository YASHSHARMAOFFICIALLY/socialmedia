import { z } from "zod";
import { NOTIFICATION_TYPES } from "./notification.service.js";
export const wsParam = z.object({ workspaceId: z.uuid() });
export const idParam = wsParam.extend({ notificationId: z.uuid() });
export const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().max(500).optional(), unread: z.enum(["true", "false"]).transform((v) => v === "true").optional() });
export const prefsBody = z.object({ preferences: z.array(z.object({ type: z.enum(NOTIFICATION_TYPES), inApp: z.boolean(), email: z.boolean() })).min(1).max(NOTIFICATION_TYPES.length) });
