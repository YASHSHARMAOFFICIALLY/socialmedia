import { z } from "zod";
import { PLATFORMS } from "../../integrations/core/types.js";

export const wsParam = z.object({ workspaceId: z.uuid() });
export const accountParams = wsParam.extend({ accountId: z.uuid() });
export const connectBody = z.object({ platform: z.enum(PLATFORMS) });
export const credentialsBody = z.object({ platform: z.enum(PLATFORMS), fields: z.record(z.string().min(1).max(64), z.string().max(4000)) });
export const callbackParams = z.object({ platform: z.enum(PLATFORMS) });
export const callbackQuery = z.object({
  code: z.string().min(1).max(2000).optional(),
  state: z.string().min(10).max(200).optional(),
  error: z.string().max(200).optional(),
  error_description: z.string().max(500).optional(),
});
