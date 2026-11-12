import { z } from "zod";
import { isValidTimeZone } from "../../shared/utils/timezone.js";

export const wsParam = z.object({ workspaceId: z.uuid() });
export const postParams = wsParam.extend({ postId: z.uuid() });
export const seriesParams = wsParam.extend({ seriesId: z.uuid() });
export const createBody = z.object({
  frequency: z.enum(["daily", "weekly", "monthly"]),
  interval: z.number().int().min(1).max(52).default(1),
  startLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  timezone: z.string().refine(isValidTimeZone, "Unknown IANA time zone"),
  count: z.number().int().min(1).max(366).optional(),
  untilDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  accountIds: z.array(z.uuid()).min(1).max(20).optional(),
}).refine((v) => v.count !== undefined || v.untilDate !== undefined, "Provide `count` or `untilDate` so a series cannot run forever by accident");
export const patchBody = z.object({ status: z.enum(["active", "paused"]) });
export const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().max(500).optional(), status: z.enum(["active", "paused", "ended"]).optional() });
