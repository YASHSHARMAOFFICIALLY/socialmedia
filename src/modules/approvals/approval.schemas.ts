import { z } from "zod";
export const wsParam = z.object({ workspaceId: z.uuid() });
export const postParams = wsParam.extend({ postId: z.uuid() });
export const requestParams = wsParam.extend({ requestId: z.uuid() });
export const policyBody = z.object({ required: z.boolean(), requiredApprovals: z.number().int().min(1).max(5).default(1) });
export const submitBody = z.object({ note: z.string().max(2000).optional() }).default({});
export const decisionBody = z.object({ decision: z.enum(["approved", "rejected"]), comment: z.string().max(2000).optional() });
export const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().max(500).optional(), status: z.enum(["pending", "approved", "rejected", "cancelled"]).optional(), postId: z.uuid().optional() });
