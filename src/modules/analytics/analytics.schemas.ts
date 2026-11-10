import { PLATFORMS } from "../../integrations/core/types.js";
import { z } from "zod";

export const wsParam = z.object({ workspaceId: z.uuid() });
export const platformParams = wsParam.extend({ platform: z.enum(PLATFORMS) });
export const accountParams = wsParam.extend({ accountId: z.uuid() });
export const postParams = wsParam.extend({ postId: z.uuid() });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => !Number.isNaN(Date.parse(d)), "Invalid date");
const platform = z.enum(PLATFORMS);
const grain = z.enum(["day", "week", "month"]);
export const rangeQuery = z.object({ from: date.optional(), to: date.optional() });
export const overviewQuery = rangeQuery.extend({ platform: platform.optional() });
export const grainQuery = rangeQuery.extend({ grain: grain.optional() });
export const postQuery = z.object({ grain: grain.optional() });
export const trendsQuery = rangeQuery.extend({ metric: z.string().min(1).max(50), grain: grain.optional(), platform: platform.optional(), accountId: z.uuid().optional() });
export const compareRangesQuery = z.object({ aFrom: date, aTo: date, bFrom: date, bTo: date, platform: platform.optional() });
export const topQuery = rangeQuery.extend({ metric: z.string().min(1).max(50).default("interactions"), platform: platform.optional(), accountId: z.uuid().optional(), limit: z.coerce.number().int().min(1).max(50).default(10) });
