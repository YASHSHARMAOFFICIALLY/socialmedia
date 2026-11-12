import { z } from "zod";
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => !Number.isNaN(Date.parse(d)), "Invalid date");
export const wsParam = z.object({ workspaceId: z.uuid() });
export const campaignParams = wsParam.extend({ campaignId: z.uuid() });
export const campaignPostParams = campaignParams.extend({ postId: z.uuid() });
export const createBody = z.object({ name: z.string().trim().min(1).max(160), description: z.string().max(5000).optional(), startDate: date.optional(), endDate: date.optional() })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, "endDate must not be before startDate");
export const updateBody = z.object({ name: z.string().trim().min(1).max(160).optional(), description: z.string().max(5000).nullable().optional(), startDate: date.nullable().optional(), endDate: date.nullable().optional(), status: z.enum(["active", "archived"]).optional() })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
export const addPostsBody = z.object({ postIds: z.array(z.uuid()).min(1).max(100) });
export const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().max(500).optional(), status: z.enum(["active", "archived"]).optional() });
export const performanceQuery = z.object({ from: date.optional(), to: date.optional(), grain: z.enum(["day", "week", "month"]).optional() });
export const compareQuery = z.object({ ids: z.string().transform((s) => s.split(",")).pipe(z.array(z.uuid()).min(2).max(5)), from: date.optional(), to: date.optional() });
