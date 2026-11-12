import { PLATFORMS } from "../../integrations/core/types.js";
import { z } from "zod";
export const wsParam = z.object({ workspaceId: z.uuid() });
export const postParams = wsParam.extend({ postId: z.uuid() });
export const jobParams = wsParam.extend({ jobId: z.uuid() });
export const publishBody = z.object({ accountIds: z.array(z.uuid()).min(1).max(20).optional() }).default({});
export const idempotencyHeader = z.string().min(8).max(100).regex(/^[\w.:-]+$/);
export const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(500).optional(),
  status: z.enum(["pending", "scheduled", "processing", "published", "failed", "cancelled"]).optional(),
  platform: z.enum(PLATFORMS).optional(),
  postId: z.uuid().optional(),
});
