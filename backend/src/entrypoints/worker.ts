// Cloudflare Workers entrypoint: HTTP (Express), scheduled (cron). Queue consumers are added in Phase 5.
import { env, waitUntil } from "cloudflare:workers";
import { httpServerHandler } from "cloudflare:node";
import express from "express";
import { createApp, type Deps } from "../app.js";
import { buildDeps } from "../composition.js";
import { loadConfig } from "../config/env.js";
import { createLogger } from "../infrastructure/logger/logger.js";
import { hyperdriveDb } from "../infrastructure/database/db.js";
import { createKvCache } from "../infrastructure/cache/cache.js";
import { cloudflareQueue } from "../infrastructure/queues/queue.js";
import { cleanupAbandonedUploads } from "../modules/media/media.service.js";
import { purgeOldRows } from "../workers/maintenance.js";
import { beat } from "../workers/heartbeat.js";

// Bindings declared in wrangler.jsonc. Env is only readable at request time, so everything is built lazily.
const bindings = env as unknown as Record<string, unknown> & { HYPERDRIVE: Hyperdrive; PUBLISH_QUEUE: Queue<{ jobId: string }>; ANALYTICS_QUEUE: Queue<{ targetId: string }>; CACHE?: KVNamespace };
let deps: Promise<Deps> | undefined;
const getDeps = () =>
  (deps ??= (async () => {
    const cfg = loadConfig(bindings);
    return buildDeps(cfg, createLogger(cfg), hyperdriveDb(bindings.HYPERDRIVE.connectionString), { queue: cloudflareQueue(bindings.PUBLISH_QUEUE), analyticsQueue: cloudflareQueue<{ targetId: string }>(bindings.ANALYTICS_QUEUE), ...(bindings.CACHE ? { cache: createKvCache(bindings.CACHE as never) } : {}), defer: (p) => waitUntil(p) });
  })());

let inner: express.Express | undefined;
const outer = express();
outer.use((req, res, next) => {
  (inner ? Promise.resolve(inner) : getDeps().then((d) => (inner = createApp(d)))).then((app) => app(req, res, next), next);
});
const http = httpServerHandler(outer.listen(3000));

export default {
  ...http,
  /** Queue consumer: publish jobs. */
  async queue(batch: MessageBatch<unknown>) {
    const { engine, db, log, metrics } = await getDeps();
    if (batch.queue.endsWith("-dlq")) {
      // Dead letters: the message exhausted its delivery retries. Postgres is the source of truth and the sweeper heals the work itself,
      // so this only makes the event visible to alerting (Workers Logs) and clears the queue.
      for (const m of batch.messages) log.error({ queue: batch.queue, body: m.body, attempts: m.attempts }, "dead-lettered queue message");
      metrics?.deadLettered(batch.queue, batch.messages.map((m) => ({ body: m.body, attempts: m.attempts })));   // counted on the owner dashboard
      await metrics?.flush();
      for (const m of batch.messages) m.ack();
      return;
    }
    if (batch.queue.startsWith("analytics-")) {
      await beat(db, "analytics").catch((err) => log.error({ err }, "heartbeat failed"));
      return engine.analytics.handleBatch(batch.messages as never);
    }
    await beat(db, "publishing").catch((err) => log.error({ err }, "heartbeat failed"));
    await engine.handleBatch(batch.messages as never);
  },
  /** Cron (every minute): outbox relay, lease recovery, reconciliation, healing. Publishing recovery never depends on analytics. */
  async scheduled(_event: ScheduledController, _env: unknown, ctx: ExecutionContext) {
    const { engine, db, log, storage } = await getDeps();
    ctx.waitUntil((async () => {
      await beat(db, "scheduling").catch((err) => log.error({ err }, "heartbeat failed"));
      // Each job family is isolated (a failure or slowness in one never stops another) and ALL are awaited: work left un-awaited
      // after this promise settles would be cancelled by the runtime.
      const [publishing] = await Promise.all([
        engine.sweep().catch((err) => { log.error({ err }, "sweep failed"); return null; }),
        engine.analytics.sweep().catch((err) => log.error({ err }, "analytics sweep failed")),
        engine.reports.sweep().catch((err) => log.error({ err }, "report sweep failed")),
        engine.notifications.sweep().catch((err) => log.error({ err }, "notification sweep failed")),
        engine.webhooks.sweep().catch((err) => log.error({ err }, "webhook delivery sweep failed")),
        engine.competitors.sweep().catch((err) => log.error({ err }, "competitor sweep failed")),
        engine.billing.sweep().catch((err) => log.error({ err }, "billing sweep failed")),
        engine.recurring.sweep().catch((err) => log.error({ err }, "recurring sweep failed")),
      ]);
      if (publishing && (publishing.errors.length || publishing.dispatched || publishing.reconciled || publishing.missed)) log.info({ report: publishing }, "publishing sweep");
      // Housekeeping runs at most hourly (minute 0) and is isolated from publishing.
      if (new Date(_event.scheduledTime).getUTCMinutes() === 0) { await cleanupAbandonedUploads(db, storage ?? null).catch((err) => log.error({ err }, "media cleanup failed")); await engine.reports.purgeExpired().catch((err) => log.error({ err }, "export purge failed")); await purgeOldRows(db).catch((err) => log.error({ err }, "housekeeping failed")); await engine.webhooks.purge().catch((err) => log.error({ err }, "webhook purge failed")); await engine.billing.purge().catch((err) => log.error({ err }, "billing purge failed")); await engine.mcp.purge().catch((err) => log.error({ err }, "mcp purge failed")); await engine.tokens.keepAlive().catch((err) => log.error({ err }, "token keep-alive failed")); await engine.tokens.reencryptStale().catch((err) => log.error({ err }, "token re-encryption failed")); }
    })());
  },
};
