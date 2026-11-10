import { z } from "zod";
import { ROLES } from "./permissions.js";

export const workspaceKind = z.enum(["personal", "startup", "business", "client"]);
export const idParam = z.object({ workspaceId: z.uuid() });
export const memberParams = idParam.extend({ userId: z.string().min(1).max(100) });
export const invitationParams = idParam.extend({ invitationId: z.uuid() });
export const createWorkspaceBody = z.object({ name: z.string().trim().min(1).max(120), kind: workspaceKind.default("business") });
export const updateWorkspaceBody = z.object({ name: z.string().trim().min(1).max(120).optional(), kind: workspaceKind.optional() }).refine((v) => v.name !== undefined || v.kind !== undefined, "Nothing to update");
export const inviteBody = z.object({ email: z.email().max(254).transform((e) => e.toLowerCase()), role: z.enum(ROLES).exclude(["owner"]) });
export const roleBody = z.object({ role: z.enum(ROLES) });
export const acceptBody = z.object({ token: z.string().min(20).max(200) });
