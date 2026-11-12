import { randomUUID } from "node:crypto";
import type { Db } from "../../infrastructure/database/db.js";
import type { Logger } from "../../infrastructure/logger/logger.js";
import type { AnalyticsMessage, JobQueue } from "../../infrastructure/queues/queue.js";
import { PlatformError } from "../../integrations/core/errors.js";
import type { AdapterRegistry } from "../../integrations/core/registry.js";
import type { AccountService } from "../../modules/accounts/account.service.js";
import { rebuildAggregates } from "../../modules/analytics/analytics.aggregator.js";
import { nextCollectionDelayS, normalize } from "../../modules/analytics/analytics.normalizer.js";
import { analyticsRepository as repo } from "../../modules/analytics/analytics.repository.js";

export interface AnalyticsDeps { db: Db; log: Logger; registry: AdapterRegistry; accounts: Pick<AccountService, "getAccessToken"> }
const CLAIM_S = 600, DISABLE_AFTER = 5;

/** Failure -> when to try again. Analytics trouble only ever affects analytics rows: nothing here can touch publishing state. */
export function failureDelay(err: unknown, failures: number): { delayS: number; disable: boolean } {
  if (err instanceof PlatformError) {
    if (err.kind === "rate_limited") return { delayS: Math.max(900, err.opts.retryAfterS ?? 0), disable: false };
    if (err.kind === "retryable") return { delayS: Math.min(6 * 3600, 300 * 2 ** failures), disable: false };
    if (err.kind === "auth_expired") return { delayS: 6 * 3600, disable: false };
  }
  return { delayS: 24 * 3600, disable: failures + 1 >= DISABLE_AFTER };
}

/** Collects one target. Never throws. */
export async function collectTarget(deps: AnalyticsDeps, targetId: string): Promise<"collected" | "skipped" | "failed"> {
  const { db, log } = deps;
  const token = randomUUID();
  let t;
  try { t = await db.tx((q) => repo.claim(q, targetId, token, CLAIM_S)); } catch (err) { log.error({ err, targetId }, "analytics claim failed"); return "failed"; }
  if (!t) return "skipped";
  try {
    const adapter = deps.registry.get(t.platform);
    const fetcher = t.scope === "post" ? adapter.fetchPostMetrics : adapter.fetchAccountMetrics;
    if (!fetcher) throw new PlatformError("permanent", `${t.platform} does not expose ${t.scope} analytics`);
    const accessToken = await deps.accounts.getAccessToken(t.workspace_id, t.social_account_id);
    const account = { externalId: t.account_external_id, metadata: t.account_metadata };
    const res = t.scope === "post"
      ? await adapter.fetchPostMetrics!({ accessToken, account, externalPostId: t.external_post_id!, publishedAt: new Date(t.published_at!) })
      : await adapter.fetchAccountMetrics!({ accessToken, account });
    const metrics = normalize(t.platform as never, res.metrics, t.scope);
    const age = t.published_at ? (Date.now() - new Date(t.published_at).getTime()) / 1000 : 0;
    await db.tx(async (q) => {
      const snap = await repo.insertSnapshot(q, t, res.source, res.raw);          // raw response is kept for debugging / future re-normalization
      await repo.insertMetrics(q, t, snap, metrics);
      await rebuildAggregates(q, t.id);
      await repo.bumpVersion(q, t.workspace_id);
      await repo.finishOk(q, t.id, token, nextCollectionDelayS(t.scope, age));
    });
    // Audience demographics change slowly: refresh weekly. Best effort, it must never fail the (already stored) account collection.
    if (t.scope === "account" && adapter.fetchAudience && !(await repo.audienceFresh(db, t.social_account_id, 6))) {
      try {
        const aud = await adapter.fetchAudience({ accessToken, account });
        await db.tx(async (q) => { for (const row of aud.rows) await repo.upsertAudience(q, t, row); await repo.bumpVersion(q, t.workspace_id); });
      } catch (e) { log.warn({ targetId, err: (e as Error).message }, "audience collection failed"); }
    }
    return "collected";
  } catch (err) {
    const { delayS, disable } = failureDelay(err, t.failures);
    log.warn({ targetId, platform: t.platform, scope: t.scope, err: (err as Error).message, delayS, disable }, "analytics collection failed");
    await db.tx((q) => repo.finishFail(q, t.id, token, delayS, (err as Error).message, disable)).catch((e) => log.error({ err: e }, "could not record analytics failure"));
    return "failed";
  }
}

export interface AnalyticsSweepReport { seeded: number; queued: number; errors: string[] }

export async function runAnalyticsSweep(deps: AnalyticsDeps, queue: JobQueue<AnalyticsMessage>, limit = 25): Promise<AnalyticsSweepReport> {
  const r: AnalyticsSweepReport = { seeded: 0, queued: 0, errors: [] };
  const step = async (name: string, fn: () => Promise<void>) => { try { await fn(); } catch (e) { r.errors.push(`${name}: ${(e as Error).message}`); deps.log.error({ err: e, step: name }, "analytics sweep step failed"); } };
  const caps = deps.registry.list().filter((p) => p.available && p.capabilities);
  await step("seed", async () => {
    r.seeded = await deps.db.tx((q) => repo.seedTargets(q, caps.filter((p) => p.capabilities!.accountAnalytics).map((p) => p.platform), caps.filter((p) => p.capabilities!.postAnalytics).map((p) => p.platform)));   // old posts retire themselves when collected (cadence policy returns null after 90 days)
  });
  await step("queue", async () => {
    const ids = await deps.db.tx((q) => repo.dueForQueue(q, limit));
    if (ids.length) await queue.sendBatch(ids.map((targetId) => ({ targetId })));   // if this throws, enqueued_at expires after 10 min and they are queued again
    r.queued = ids.length;
  });
  return r;
}
