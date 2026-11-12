import { z } from "zod";
import { WEBHOOK_EVENTS } from "./webhook.service.js";
export const wsParam = z.object({ workspaceId: z.uuid() });
export const idParam = wsParam.extend({ webhookId: z.uuid() });
const events = z.array(z.enum([...WEBHOOK_EVENTS, "*"])).min(1).max(20);
export const createBody = z.object({ url: z.string().url().max(2000), events: events.default(["*"]) });
export const updateBody = z.object({ url: z.string().url().max(2000).optional(), events: events.optional(), enabled: z.boolean().optional() }).refine((v) => Object.keys(v).length > 0, "Nothing to update");
export const deliveriesQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().max(500).optional() });
