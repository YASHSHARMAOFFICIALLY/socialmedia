import { z } from "zod";
import type { Db } from "../../infrastructure/database/db.js";
import { AppError, notFound } from "../../shared/errors/errors.js";
import { decodeCursor, page } from "../../shared/utils/pagination.js";
import { auditRepository } from "../audit/audit.repository.js";
import { contentRepository } from "../content/content.repository.js";
import type { ContentService } from "../content/content.service.js";
import type { Actor, WorkspaceService } from "../workspaces/workspace.service.js";
import { publishingRepository as repo, type JobRow } from "./publishing.repository.js";
import { isCancellable } from "./publishing.state-machine.js";

const CONFLICT_WINDOW_MIN = 5;
const cursorSchema = z.object({ createdAt: z.string(), id: z.string() });
// Strip internal columns (lease fence, idempotency marker) before anything leaves the service.
const view = ({ workspace_id: _w, lease_token: _l, lease_until: _u, unknown_since: _s, idempotency_key: _i, ...j }: Partial<JobRow> & { id: string }) => j;

export function createPublishingService(deps: { db: Db; workspaces: WorkspaceService; content: ContentService; kick: () => Promise<unknown>; approvalGate?: { assertPublishable(q: import("../../infrastructure/database/db.js").Queryable, ws: string, postId: string): Promise<void> }; log: { warn(o: object, m: string): void } }) {
  const { db, workspaces, content } = deps;
  /** Best effort: push new outbox rows to the queue right away. If it fails the sweeper does it within a minute. */
  const kick = () => deps.kick().catch((err) => deps.log.warn({ err }, "immediate outbox dispatch failed; sweeper will retry"));

  return {
    /**
     * Publish now. Creates one independent job per destination, all or nothing, in one transaction together with the
     * outbox rows. Safe to call repeatedly (Idempotency-Key replays; the DB forbids a second live job per variant).
     */
    async publish(a: Actor, workspaceId: string, postId: string, opts: { accountIds?: string[] | undefined; idempotencyKey?: string | undefined; schedule?: { at: Date; timezone: string; allowConflicts?: boolean } | undefined }) {
      const result = await db.tx(async (q) => {
        await workspaces.authorize(a.id, workspaceId, "publish:create", q);
        if (opts.idempotencyKey) {
          if (!(await repo.claimIdempotencyKey(q, workspaceId, opts.idempotencyKey, postId))) {
            const prev = await repo.getIdempotent(q, workspaceId, opts.idempotencyKey);
            if (prev?.post_id !== postId) throw new AppError(422, "IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was used for a different post");
            return { ...(prev.response as object), replayed: true };
          }
        }
        const post = await contentRepository.getPost(q, workspaceId, postId, true);
        if (!post) throw notFound("Post");
        await deps.approvalGate?.assertPublishable(q, workspaceId, postId);   // approval-required workspaces: nothing is created without an approved, unchanged version
        const { variants, report } = await content.validateForPublish(workspaceId, postId, q);
        const selected = variants.filter((v) => !opts.accountIds || opts.accountIds.includes(v.social_account_id));
        if (opts.accountIds && selected.length !== new Set(opts.accountIds).size) throw notFound("Variant");
        if (selected.length === 0) throw new AppError(422, "NO_DESTINATIONS", "The post has no destinations to publish to");
        const blocked = report.variants.filter((r) => selected.some((v) => v.social_account_id === r.accountId) && !r.publishable);
        if (blocked.length) throw new AppError(422, "POST_NOT_PUBLISHABLE", "Some destinations cannot be published", { variants: blocked });

        const live = await repo.blockedVariantIds(q, workspaceId, postId);
        const targets = selected.filter((v) => !live.has(v.id));
        if (targets.length === 0) throw new AppError(409, "ALREADY_SUBMITTED", "Every selected destination is already queued, published or failed (use retry for failed publications)");
        const now = new Date();
        const sched = opts.schedule;
        if (sched && !sched.allowConflicts) {
          const clash = (await repo.conflicts(q, workspaceId, targets.map((v) => v.social_account_id), sched.at, CONFLICT_WINDOW_MIN, postId)).rows;
          if (clash.length) throw new AppError(409, "SCHEDULE_CONFLICT", `Another post is scheduled on the same account within ${CONFLICT_WINDOW_MIN} minutes`, { conflicts: clash.map((c) => ({ jobId: c.id, postId: c.post_id, accountId: c.social_account_id, at: c.next_attempt_at })) });
        }
        const runAt = sched?.at ?? now;
        const jobs = [];
        for (const v of targets) {
          let job;
          try {
            job = await repo.insertJob(q, { workspaceId, postId, variantId: v.id, accountId: v.social_account_id, platform: v.platform, status: sched ? "scheduled" : "pending", runAt, userId: a.id });
          } catch (e) {
            if ((e as { code?: string }).code === "23505") throw new AppError(409, "ALREADY_SUBMITTED", "A publication for this destination already exists"); // lost a race
            throw e;
          }
          await repo.event(q, { jobId: job.id, workspaceId, from: null, to: sched ? "scheduled" : "pending", reason: sched ? `scheduled for ${runAt.toISOString()}` : "publish requested", actorId: a.id });
          await repo.enqueueOutbox(q, workspaceId, job.id, runAt);   // the relay only releases it when it is due
          jobs.push(view(job));
        }
        await repo.markPostSubmitted(q, workspaceId, postId);
        if (sched) await repo.upsertSchedule(q, { workspaceId, postId, at: sched.at, timezone: sched.timezone, userId: a.id });
        await auditRepository.record(q, { workspaceId, actorId: a.id, action: sched ? "post.scheduled" : "post.publish_requested", entityType: "post", entityId: postId, metadata: { jobs: jobs.length }, ...(a.requestId ? { requestId: a.requestId } : {}) });
        const response = { jobs, skipped: selected.filter((v) => live.has(v.id)).map((v) => v.social_account_id) };
        if (opts.idempotencyKey) await repo.saveIdempotent(q, workspaceId, opts.idempotencyKey, response);
        return response;
      });
      await kick();
      return result;
    },

    async list(a: Actor, workspaceId: string, f: { limit: number; cursor?: string | undefined; status?: string | undefined; platform?: string | undefined; postId?: string | undefined }) {
      await workspaces.authorize(a.id, workspaceId, "content:read");
      const rows = (await repo.listJobs(db, workspaceId, { ...f, after: decodeCursor(f.cursor, cursorSchema) })).rows;
      return page(rows, f.limit, (r) => ({ createdAt: r.created_at, id: r.id }));
    },

    async get(a: Actor, workspaceId: string, jobId: string) {
      await workspaces.authorize(a.id, workspaceId, "content:read");
      const job = await repo.getJob(db, workspaceId, jobId);
      if (!job) throw notFound("Publication");
      const [attempts, events] = await Promise.all([repo.attempts(db, workspaceId, jobId), repo.events(db, workspaceId, jobId)]);
      return { ...job, attempts: attempts.rows, events: events.rows };
    },

    async cancel(a: Actor, workspaceId: string, jobId: string) {
      await db.tx(async (q) => {
        await workspaces.authorize(a.id, workspaceId, "publish:cancel", q);
        const job = await repo.lockJob(q, workspaceId, jobId);
        if (!job) throw notFound("Publication");
        if (!isCancellable(job.status) || !(await repo.cancel(q, workspaceId, jobId)))
          throw new AppError(409, "NOT_CANCELLABLE", `A publication in status '${job.status}' cannot be cancelled`);
        await repo.event(q, { jobId, workspaceId, from: job.status, to: "cancelled", reason: "cancelled by user", actorId: a.id });
      });
    },

    /** Manual retry of a failed job (e.g. after reconnecting an account or fixing media). */
    async retry(a: Actor, workspaceId: string, jobId: string) {
      const out = await db.tx(async (q) => {
        await workspaces.authorize(a.id, workspaceId, "publish:create", q);
        const job = await repo.lockJob(q, workspaceId, jobId);
        if (!job) throw notFound("Publication");
        if (job.status !== "failed") throw new AppError(409, "NOT_RETRYABLE", `Only failed publications can be retried (status is '${job.status}')`);
        try { await repo.retry(q, workspaceId, jobId); } catch (e) {
          if ((e as { code?: string }).code === "23505") throw new AppError(409, "ALREADY_SUBMITTED", "This destination already has a live publication");
          throw e;
        }
        await repo.event(q, { jobId, workspaceId, from: "failed", to: "pending", reason: `manual retry${job.failure_kind === "unconfirmed" ? " (previous outcome was unconfirmed: duplicate possible)" : ""}`, actorId: a.id });
        await repo.enqueueOutbox(q, workspaceId, jobId, new Date());
        return { ...view((await repo.getJob(q, workspaceId, jobId))!), warning: job.failure_kind === "unconfirmed" ? "The previous attempt's outcome could not be confirmed; the post may already exist on the platform." : undefined };
      });
      await kick();
      return out;
    },
  };
}
export type PublishingService = ReturnType<typeof createPublishingService>;
