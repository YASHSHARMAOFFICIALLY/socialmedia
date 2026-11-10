import type { EngineDeps } from "./process-job.js";
import { processPublishJob } from "./process-job.js";
import type { PublishMessage } from "../../infrastructure/queues/queue.js";

export interface QueueMessageLike { body: PublishMessage; ack(): void; retry(o?: { delaySeconds?: number }): void }

/**
 * Queue consumer. The DB claim makes processing idempotent, so at-least-once delivery is safe. Only infrastructure errors
 * (DB down while claiming) reach `retry`; publish outcomes are recorded in Postgres by processPublishJob.
 */
export async function handlePublishBatch(deps: EngineDeps, messages: readonly QueueMessageLike[]) {
  for (const m of messages) {
    try {
      await processPublishJob(deps, m.body.jobId);
      m.ack();
    } catch (err) {
      deps.log.error({ err, jobId: m.body.jobId }, "publish message failed; will be redelivered");
      m.retry({ delaySeconds: 30 });
    }
  }
}
