export interface PublishMessage { jobId: string }
export interface AnalyticsMessage { targetId: string }
/** Delivery mechanism only. Postgres is the source of truth; losing a message is recoverable by the sweeper. */
export interface JobQueue<T = PublishMessage> { sendBatch(msgs: T[]): Promise<void> }

export const cloudflareQueue = <T = PublishMessage>(q: { sendBatch(msgs: { body: T }[]): Promise<unknown> }): JobQueue<T> => ({
  sendBatch: async (msgs) => { if (msgs.length) await q.sendBatch(msgs.map((body) => ({ body }))); },
});
