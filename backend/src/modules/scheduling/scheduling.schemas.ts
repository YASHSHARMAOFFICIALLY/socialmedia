import { PLATFORMS } from "../../integrations/core/types.js";
import { z } from "zod";
import { isValidTimeZone } from "../../shared/utils/timezone.js";

export const wsParam = z.object({ workspaceId: z.uuid() });
export const postParams = wsParam.extend({ postId: z.uuid() });

const tz = z.string().refine(isValidTimeZone, "Unknown IANA time zone");
/**
 * Either an absolute instant (`scheduledAt` with Z/offset) or a wall-clock time in a zone (`localDateTime` + `timezone`,
 * DST-aware). `timezone` is also stored for display when `scheduledAt` is used.
 */
export const when = z.object({
  scheduledAt: z.iso.datetime({ offset: true }).optional(),
  localDateTime: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/).optional(),
  timezone: tz.default("UTC"),
}).refine((v) => (v.scheduledAt === undefined) !== (v.localDateTime === undefined), "Provide exactly one of scheduledAt or localDateTime");

export const scheduleBody = when.and(z.object({ accountIds: z.array(z.uuid()).min(1).max(20).optional(), allowConflicts: z.boolean().default(false) }));
export const rescheduleBody = when.and(z.object({ allowConflicts: z.boolean().default(false) }));

export const bulkScheduleBody = z.object({
  items: z.array(z.intersection(z.object({ postId: z.uuid() }), scheduleBody)).min(1).max(100),
});
export const bulkCreateBody = z.object({ posts: z.array(z.unknown()).min(1).max(50) });
export const bulkIdsBody = z.object({ ids: z.array(z.uuid()).min(1).max(200) });

export const calendarQuery = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  weekOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  timezone: tz.default("UTC"),
  platform: z.enum(PLATFORMS).optional(),
  status: z.enum(["pending", "scheduled", "processing", "published", "failed", "cancelled"]).optional(),
}).refine((v) => [v.month, v.weekOf, v.from && v.to].filter(Boolean).length === 1, "Provide exactly one of: month, weekOf, or from+to");
