import { randomUUID } from "node:crypto";
import { PlatformError } from "../../integrations/core/errors.js";
import type { Queryable } from "../../infrastructure/database/db.js";
import type { JobQueue } from "../../infrastructure/queues/queue.js";
import { publishingRepository as repo, type JobRow } from "../../modules/publishing/publishing.repository.js";
import { buildPublishInput, type EngineDeps } from "./process-job.js";

const RECONCILE_WINDOW_S = 600;   // keep checking the platform this long before declaring the outcome unconfirmed
const RECONCILE_LEASE_S = 120;

/** Moves due outbox rows to the queue. If the queue is down the transaction rolls back and the rows stay for the next run. */
export async function dispatchOutbox(deps: Pick<EngineDeps, "db" | "log">, queue: JobQueue, limit = 50): Promise<number> {
  return deps.db.tx(async (q) => {
    const rows = (await repo.dueOutbox(q, limit)).rows;
    if (rows.length === 0) return 0;
    await queue.sendBatch(rows.map((r) => ({ jobId: r.aggregate_id })));
    await repo.markOutboxDispatched(q, rows.map((r) => r.id), [...new Set(rows.map((r) => r.aggregate_id))]);
    return rows.length;
  });
}

async function reconcileOne(deps: EngineDeps, found: JobRow & { unknown_age_s: number }): Promise<"published" | "failed" | "pending"> {
  const { db } = deps;
  const token = randomUUID();
  const job = await db.tx((q) => repo.leaseForReconcile(q, found.id, token, RECONCILE_LEASE_S));
  if (!job) return "pending"; // someone else owns it
  const unconfirmed = (reason: string) =>
    db.tx(async (q) => {
      if (await repo.markFailed(q, job, "unconfirmed", reason)) {
        await repo.event(q, { jobId: job.id, workspaceId: job.workspace_id, from: "processing", to: "failed", reason });
        await repo.finishAttempt(q, job, "unknown", { message: reason });
      }
      return "failed" as const;
    });
  try {
    const { adapter, input } = await buildPublishInput(deps, job);
    if (!adapter.reconcile) return unconfirmed("Publication outcome is unknown and this platform cannot be checked. It may already be live: check the account before retrying.");
    const hit = await adapter.reconcile({ accessToken: input.accessToken, account: input.account, content: input.content, idempotencyKey: input.idempotencyKey, since: new Date(new Date(job.created_at).getTime() - 60_000) });
    if (hit) {
      await db.tx(async (q) => {
        if (await repo.markPublished(q, job, hit)) {
          await repo.finishAttempt(q, job, "success", { response: hit.raw, message: "confirmed by reconciliation" });
          await repo.event(q, { jobId: job.id, workspaceId: job.workspace_id, from: "processing", to: "published", reason: `reconciled: found external id ${hit.externalId}` });
        }
      });
      return "published";
    }
  } catch (e) {
    if (!(e instanceof PlatformError) || e.kind === "permanent" || e.kind === "auth_expired") { if (found.unknown_age_s >= RECONCILE_WINDOW_S) return unconfirmed(`Could not verify outcome: ${(e as Error).message}`); }
  }
  // Not found yet (platforms are eventually consistent) or transient error: look again on the next sweep until the window passes.
  if (found.unknown_age_s >= RECONCILE_WINDOW_S) return unconfirmed("No matching post found on the platform after the reconciliation window. It was probably not published; retry if you are sure.");
  await db.tx((q) => repo.releaseReconcileLease(q, job.id, token));
  return "pending";
}

export interface SweepReport { leasesExpired: number; missed: number; healed: number; dispatched: number; reconciled: number; errors: string[] }
const MISSED_AFTER_HOURS = 6;

/** One idempotent maintenance pass. Each step is isolated: a failing step never prevents the others from running. */
export async function runPublishingSweep(deps: EngineDeps, queue: JobQueue): Promise<SweepReport> {
  const r: SweepReport = { leasesExpired: 0, missed: 0, healed: 0, dispatched: 0, reconciled: 0, errors: [] };
  const step = async (name: string, fn: () => Promise<void>) => { try { await fn(); } catch (e) { r.errors.push(`${name}: ${(e as Error).message}`); deps.log.error({ err: e, step: name }, "sweep step failed"); } };

  await step("expire-leases", async () => {
    const expired = await deps.db.tx(async (q: Queryable) => {
      const rows = await repo.expireLeases(q, 50);
      for (const j of rows) await repo.event(q, { jobId: j.id, workspaceId: j.workspace_id, from: "processing", to: "processing", reason: "worker lease expired; outcome unknown, awaiting reconciliation" });
      return rows.length;
    });
    r.leasesExpired = expired;
  });
  // Outage recovery: scheduled posts that are many hours late are NOT silently published (stale content); the owner is told and decides.
  await step("expire-missed", async () => {
    r.missed = await deps.db.tx(async (q) => {
      const rows = await repo.expireMissed(q, MISSED_AFTER_HOURS, 100);
      if (rows.length) await repo.dropPendingOutbox(q, rows.map((x) => x.id));
      for (const j of rows) await repo.event(q, { jobId: j.id, workspaceId: j.workspace_id, from: "scheduled", to: "failed", reason: `missed: overdue by more than ${MISSED_AFTER_HOURS}h` });
      return rows.length;
    });
  });
  await step("heal-orphans", async () => {
    r.healed = await deps.db.tx(async (q) => {
      const rows = (await repo.orphanedDueJobs(q, 50)).rows;
      for (const j of rows) await repo.enqueueOutbox(q, j.workspace_id, j.id, new Date());
      return rows.length;
    });
  });
  await step("dispatch-outbox", async () => { r.dispatched = await dispatchOutbox(deps, queue); });
  await step("reconcile", async () => {
    const rows = (await repo.reconcilable(deps.db, 10)).rows;
    for (const j of rows) { const res = await reconcileOne(deps, j); if (res !== "pending") r.reconciled++; }
  });
  return r;
}
