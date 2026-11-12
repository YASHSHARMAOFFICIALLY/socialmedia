import type { AnalyticsMessage } from "../../infrastructure/queues/queue.js";
import { collectTarget, type AnalyticsDeps } from "./collect.js";

export interface AnalyticsMessageLike { body: AnalyticsMessage; ack(): void; retry(o?: { delaySeconds?: number }): void }
export async function handleAnalyticsBatch(deps: AnalyticsDeps, messages: readonly AnalyticsMessageLike[]) {
  for (const m of messages) {
    await collectTarget(deps, m.body.targetId);   // never throws; failures are recorded on the target and rescheduled there
    m.ack();
  }
}
