import { randomUUID } from "node:crypto";
import type { Db } from "../../infrastructure/database/db.js";
import type { Logger } from "../../infrastructure/logger/logger.js";
import { PlatformError } from "../../integrations/core/errors.js";
import type { AdapterRegistry } from "../../integrations/core/registry.js";
import type { PublishInput, PublishResult, ResolvedMedia } from "../../integrations/core/types.js";
import type { AccountService } from "../../modules/accounts/account.service.js";
import { resolveVariant } from "../../modules/content/content.validator.js";
import type { ContentService } from "../../modules/content/content.service.js";
import { publishingRepository as repo, type JobRow } from "../../modules/publishing/publishing.repository.js";
import { decideFailure } from "../../modules/publishing/publishing.state-machine.js";

export interface EngineDeps {
  db: Db; log: Logger; registry: AdapterRegistry;
  accounts: Pick<AccountService, "getAccessToken">;
  content: Pick<ContentService, "validateForPublish">;
  /** Signed, time-limited download URL for a stored media object (object storage lands with the media module). */
  mediaUrl?: ((storageKey: string) => Promise<string>) | undefined;
  leaseSeconds?: number;      // how long a worker may hold a job before it is presumed crashed
  timeoutMs?: number;         // hard cap on the platform call
  random?: () => number;
}
const LEASE_S = 300, TIMEOUT_MS = 120_000;

async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(ac.signal),
      new Promise<never>((_, rej) => { timer = setTimeout(() => { ac.abort(); rej(new PlatformError("unknown", `Platform call timed out after ${ms}ms; outcome unknown`)); }, ms); }),
    ]);
  } finally { clearTimeout(timer); }
}

/** Everything the adapter needs. Throws PlatformError/AppError for anything that makes the job unrunnable. */
export async function buildPublishInput(deps: EngineDeps, job: JobRow): Promise<{ input: Omit<PublishInput, "signal">; adapter: ReturnType<AdapterRegistry["get"]> }> {
  const { post, variants, media, report } = await deps.content.validateForPublish(job.workspace_id, job.post_id);
  const variant = variants.find((v) => v.id === job.variant_id);
  if (!variant) throw new PlatformError("permanent", "Variant no longer exists");
  const vr = report.variants.find((v) => v.accountId === variant.social_account_id);
  if (!vr || !vr.valid) throw new PlatformError("permanent", `Content is invalid: ${vr?.issues.filter((i) => i.severity === "error").map((i) => i.message).join("; ") ?? "variant missing"}`);
  let adapter;
  try { adapter = deps.registry.get(job.platform); } catch { throw new PlatformError("permanent", `Platform ${job.platform} is not available`); }
  if (!adapter.publish) throw new PlatformError("permanent", `Publishing is not implemented for ${job.platform}`);
  if (!vr.publishable) throw new PlatformError("permanent", `Not publishable: ${vr.publishBlockers.join("; ")}`);

  const accessToken = await deps.accounts.getAccessToken(job.workspace_id, job.social_account_id); // refreshes if needed; throws auth_expired
  const content = resolveVariant(post, variant, media);
  const own = media.filter((m) => m.variant_id === variant.id);
  const chosen = own.length ? own : media.filter((m) => m.variant_id === null);
  const resolved: ResolvedMedia[] = chosen.map((m) => ({
    id: m.media_id, kind: m.kind, role: m.role, mimeType: m.mime_type, sizeBytes: Number(m.size_bytes), storageKey: m.storage_key,
    url: async () => { if (!deps.mediaUrl) throw new PlatformError("permanent", "Media storage is not configured"); return deps.mediaUrl(m.storage_key); },
  }));
  const acct = await deps.db.query<{ external_id: string; metadata: Record<string, unknown> }>("SELECT external_id, metadata FROM social_accounts WHERE workspace_id = $1 AND id = $2", [job.workspace_id, job.social_account_id]);
  const a = acct.rows[0];
  if (!a) throw new PlatformError("permanent", "Account no longer exists");
  return { adapter, input: { accessToken, account: { externalId: a.external_id, metadata: a.metadata }, content, media: resolved, idempotencyKey: job.idempotency_key } };
}

export type ProcessResult = "published" | "retry_scheduled" | "failed" | "reconciling" | "skipped" | "lease_lost";

/**
 * Runs one publishing job. Safe to call any number of times concurrently for the same id: the atomic claim lets exactly one
 * caller proceed. No DB connection or transaction is held while the platform call is in flight.
 */
export async function processPublishJob(deps: EngineDeps, jobId: string): Promise<ProcessResult> {
  const { db, log } = deps;
  const token = randomUUID();
  const job = await db.tx(async (q) => {
    const j = await repo.claim(q, jobId, token, deps.leaseSeconds ?? LEASE_S);
    if (!j) return null;
    await repo.startAttempt(q, j);
    await repo.event(q, { jobId: j.id, workspaceId: j.workspace_id, from: "pending", to: "processing", reason: `attempt ${j.attempt_count}` });
    return j;
  });
  if (!job) return "skipped"; // duplicate message, not due yet, cancelled, or already handled

  let result: PublishResult;
  try {
    const { adapter, input } = await buildPublishInput(deps, job);
    result = await withTimeout((signal) => adapter.publish!({ ...input, signal }), deps.timeoutMs ?? TIMEOUT_MS)
      .catch((err: unknown) => { throw asPublishError(err); });
  } catch (err) {
    return handleFailure(deps, job, err);
  }

  // The post is LIVE from here. A bookkeeping error must never reach handleFailure (it would mark the job failed and a manual retry would duplicate the post).
  const persist = () => db.tx(async (q) => {
    const n = await repo.markPublished(q, job, result);
    if (!n) return false;
    await repo.recordPublishedUsage(q, job);
    await repo.finishAttempt(q, job, "success", { response: result.warnings?.length ? { raw: result.raw, warnings: result.warnings } : result.raw });
    await repo.event(q, { jobId: job.id, workspaceId: job.workspace_id, from: "processing", to: "published", reason: `external id ${result.externalId}` });
    return true;
  });
  let ok: boolean;
  try {
    try { ok = await persist(); } catch { ok = await persist(); } // persist is idempotent (fenced by lease, usage keyed), so one immediate retry is safe
  } catch (err) {
    log.error({ jobId, externalId: result.externalId, err: err instanceof Error ? err.message : String(err) }, "published but could not record it; handing to reconciliation");
    // Best effort; if even this fails the lease expires and the sweeper reconciles the job.
    await db.tx(async (q) => {
      if (await repo.markUnknown(q, job, "published on the platform but recording failed", result)) await repo.event(q, { jobId: job.id, workspaceId: job.workspace_id, from: "processing", to: "processing", reason: `published (external id ${result.externalId}) but recording failed; awaiting reconciliation` });
    }).catch(() => {});
    return "reconciling";
  }
  if (!ok) { log.error({ jobId, externalId: result.externalId }, "published but lease was lost; reconciliation will confirm"); return "lease_lost"; }
  return "published";
}

/**
 * Adapters must throw PlatformError. Anything else escaped after the creating request may have been sent
 * (e.g. JSON parse of an empty 200), so it is "unknown" (reconcile), never "permanent" (a retry would duplicate).
 */
function asPublishError(err: unknown): unknown {
  if (err instanceof PlatformError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new PlatformError("unknown", `Unexpected error while publishing: ${message}`);
}

async function handleFailure(deps: EngineDeps, job: JobRow, err: unknown): Promise<ProcessResult> {
  const { db, log } = deps;
  const d = decideFailure(err, job.attempt_count, job.max_attempts, deps.random);
  const pe = err instanceof PlatformError ? err : null;
  const outcome = pe?.kind ?? "permanent";
  const msg = err instanceof Error ? err.message : String(err);
  log.warn({ jobId: job.id, platform: job.platform, attempt: job.attempt_count, decision: d.action, err: msg }, "publish attempt failed");

  return db.tx(async (q) => {
    const fin = { message: msg, ...(pe?.opts.status ? { httpStatus: pe.opts.status } : {}) };
    if (d.action === "retry") {
      const row = await repo.markRetry(q, job, d.delayS, d.kind, d.message);
      if (!row) return "lease_lost";
      await repo.finishAttempt(q, job, outcome, fin);
      await repo.event(q, { jobId: job.id, workspaceId: job.workspace_id, from: "processing", to: "pending", reason: `${d.kind}; retry in ${d.delayS}s` });
      await repo.enqueueOutbox(q, job.workspace_id, job.id, new Date(row.next_attempt_at));
      return "retry_scheduled";
    }
    if (d.action === "fail") {
      if (!(await repo.markFailed(q, job, d.kind, d.message))) return "lease_lost";
      await repo.finishAttempt(q, job, outcome, fin);
      await repo.event(q, { jobId: job.id, workspaceId: job.workspace_id, from: "processing", to: "failed", reason: `${d.kind}: ${d.message}` });
      return "failed";
    }
    // Outcome unknown: do NOT retry (could duplicate). Keep the job 'processing' and let the reconciler look at the platform.
    if (!(await repo.markUnknown(q, job, d.message))) return "lease_lost";
    await repo.finishAttempt(q, job, "unknown", fin);
    await repo.event(q, { jobId: job.id, workspaceId: job.workspace_id, from: "processing", to: "processing", reason: "outcome unknown; awaiting reconciliation" });
    return "reconciling";
  });
}
