import type { Db } from "../../infrastructure/database/db.js";
import { AppError, badRequest, notFound } from "../../shared/errors/errors.js";
import { localDate, localIso, zonedLocalToUtc } from "../../shared/utils/timezone.js";
import { auditRepository } from "../audit/audit.repository.js";
import type { ContentService } from "../content/content.service.js";
import { contentRepository } from "../content/content.repository.js";
import type { VariantInput } from "../content/content.schemas.js";
import { publishingRepository as repo } from "../publishing/publishing.repository.js";
import type { PublishingService } from "../publishing/publishing.service.js";
import type { Actor, WorkspaceService } from "../workspaces/workspace.service.js";

const MIN_LEAD_MS = 60_000, MAX_LEAD_MS = 366 * 86_400_000, CONFLICT_WINDOW_MIN = 5, MAX_RANGE_MS = 62 * 86_400_000;

interface When { scheduledAt?: string | undefined; localDateTime?: string | undefined; timezone: string }

/** Turns user input into a validated UTC instant. */
export function resolveWhen(w: When, now = new Date()): { at: Date; timezone: string; ambiguous: boolean } {
  let at: Date, ambiguous = false;
  if (w.localDateTime) {
    const r = zonedLocalToUtc(w.localDateTime, w.timezone);
    if (!r.ok) throw badRequest(r.reason === "nonexistent_local_time" ? `${w.localDateTime} does not exist in ${w.timezone} (daylight-saving gap); pick another time` : `Invalid ${r.reason.replace("_", " ")}`);
    at = r.utc; ambiguous = r.ambiguous;
  } else at = new Date(w.scheduledAt!);
  const lead = at.getTime() - now.getTime();
  if (lead < MIN_LEAD_MS) throw badRequest("Scheduled time must be at least one minute in the future");
  if (lead > MAX_LEAD_MS) throw badRequest("Posts can be scheduled at most one year ahead");
  return { at, timezone: w.timezone, ambiguous };
}

export function createSchedulingService(deps: { db: Db; workspaces: WorkspaceService; publishing: PublishingService; content: ContentService; now?: () => Date }) {
  const { db, workspaces, publishing, content } = deps;
  const now = () => deps.now?.() ?? new Date();

  const service = {
    async schedule(a: Actor, workspaceId: string, postId: string, input: When & { accountIds?: string[] | undefined; allowConflicts?: boolean | undefined }) {
      const w = resolveWhen(input, now());
      const out = await publishing.publish(a, workspaceId, postId, { accountIds: input.accountIds, schedule: { at: w.at, timezone: w.timezone, allowConflicts: input.allowConflicts ?? false } });
      return { ...out, scheduledAt: w.at.toISOString(), timezone: w.timezone, ...(w.ambiguous ? { warning: `${input.localDateTime} occurs twice in ${w.timezone} (daylight-saving overlap); the earlier occurrence was used` } : {}) };
    },

    async getSchedule(a: Actor, workspaceId: string, postId: string) {
      await workspaces.authorize(a.id, workspaceId, "calendar:read");
      const s = await repo.getSchedule(db, workspaceId, postId);
      if (!s) throw notFound("Schedule");
      const state = s.status === "cancelled" ? "cancelled" : s.scheduled_jobs > 0 ? "scheduled" : "fired";
      return { postId: s.post_id, scheduledAt: s.scheduled_at, timezone: s.timezone, localTime: localIso(s.scheduled_at, s.timezone), state, pendingDestinations: s.scheduled_jobs };
    },

    /** Moves every not-yet-due destination of the post to a new time (calendar drag-and-drop). */
    async reschedule(a: Actor, workspaceId: string, postId: string, input: When & { allowConflicts?: boolean | undefined }) {
      const w = resolveWhen(input, now());
      return db.tx(async (q) => {
        await workspaces.authorize(a.id, workspaceId, "publish:create", q);
        if (!(await contentRepository.getPost(q, workspaceId, postId, true))) throw notFound("Post");
        const jobs = await repo.scheduledJobs(q, workspaceId, postId);
        if (jobs.length === 0) throw new AppError(409, "NOT_SCHEDULED", "This post has no scheduled destinations waiting to be published");
        if (!input.allowConflicts) {
          const clash = (await repo.conflicts(q, workspaceId, jobs.map((j) => j.social_account_id), w.at, CONFLICT_WINDOW_MIN, postId)).rows;
          if (clash.length) throw new AppError(409, "SCHEDULE_CONFLICT", `Another post is scheduled on the same account within ${CONFLICT_WINDOW_MIN} minutes`, { conflicts: clash.map((c) => ({ jobId: c.id, postId: c.post_id, accountId: c.social_account_id, at: c.next_attempt_at })) });
        }
        const moved = await repo.moveScheduled(q, workspaceId, jobs.map((j) => j.id), w.at);   // guarded: jobs that just became due are not moved
        if (moved.length === 0) throw new AppError(409, "NOT_SCHEDULED", "The scheduled time has already arrived");
        await repo.dropPendingOutbox(q, moved);
        for (const id of moved) { await repo.enqueueOutbox(q, workspaceId, id, w.at); await repo.event(q, { jobId: id, workspaceId, from: "scheduled", to: "scheduled", reason: `rescheduled to ${w.at.toISOString()}`, actorId: a.id }); }
        await repo.upsertSchedule(q, { workspaceId, postId, at: w.at, timezone: w.timezone, userId: a.id });
        await auditRepository.record(q, { workspaceId, actorId: a.id, action: "post.rescheduled", entityType: "post", entityId: postId, metadata: { at: w.at.toISOString() }, ...(a.requestId ? { requestId: a.requestId } : {}) });
        return { postId, scheduledAt: w.at.toISOString(), timezone: w.timezone, rescheduled: moved.length, ...(w.ambiguous ? { warning: "daylight-saving overlap: the earlier occurrence was used" } : {}) };
      });
    },

    /** Cancels the waiting destinations. If nothing else exists for the post it becomes an editable draft again. */
    async cancelSchedule(a: Actor, workspaceId: string, postId: string) {
      return db.tx(async (q) => {
        await workspaces.authorize(a.id, workspaceId, "publish:cancel", q);
        if (!(await contentRepository.getPost(q, workspaceId, postId, true))) throw notFound("Post");
        const jobs = await repo.scheduledJobs(q, workspaceId, postId);
        const cancelled = jobs.length ? await repo.cancelScheduled(q, workspaceId, jobs.map((j) => j.id)) : [];
        if (cancelled.length === 0) throw new AppError(409, "NOT_SCHEDULED", "This post has no scheduled destinations to cancel");
        await repo.dropPendingOutbox(q, cancelled);
        for (const id of cancelled) await repo.event(q, { jobId: id, workspaceId, from: "scheduled", to: "cancelled", reason: "schedule cancelled", actorId: a.id });
        await repo.cancelSchedule(q, workspaceId, postId);
        if (!(await repo.postHasJobs(q, workspaceId, postId))) await repo.reopenPost(q, workspaceId, postId);
        await auditRepository.record(q, { workspaceId, actorId: a.id, action: "post.schedule_cancelled", entityType: "post", entityId: postId, ...(a.requestId ? { requestId: a.requestId } : {}) });
        return { postId, cancelled: cancelled.length };
      });
    },

    /** Month / week / arbitrary-range calendar data. Everything is returned in UTC plus local time and a per-local-day grouping. */
    async calendar(a: Actor, workspaceId: string, q: { from?: string | undefined; to?: string | undefined; month?: string | undefined; weekOf?: string | undefined; timezone: string; platform?: string | undefined; status?: string | undefined }) {
      await workspaces.authorize(a.id, workspaceId, "calendar:read");
      let from: Date, to: Date;
      const local = (s: string) => { const r = zonedLocalToUtc(s, q.timezone); if (!r.ok) throw badRequest(`Invalid range start (${r.reason})`); return r.utc; };
      if (q.month) {
        const [y, m] = q.month.split("-").map(Number) as [number, number];
        from = local(`${q.month}-01T00:00`);
        to = local(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01T00:00`);
      } else if (q.weekOf) {
        from = local(`${q.weekOf}T00:00`);
        const d = new Date(`${q.weekOf}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 7);
        to = local(`${d.toISOString().slice(0, 10)}T00:00`);
      } else { from = new Date(q.from!); to = new Date(q.to!); }
      if (!(from < to)) throw badRequest("Range end must be after its start");
      if (to.getTime() - from.getTime() > MAX_RANGE_MS) throw badRequest("Calendar range is limited to 62 days");

      const LIMIT = 1000;
      const [jobs, drafts] = await Promise.all([repo.calendar(db, workspaceId, { from, to, platform: q.platform, status: q.status, limit: LIMIT + 1 }), repo.draftsWithoutJobs(db, workspaceId, 50)]);
      const events = jobs.rows.slice(0, LIMIT).map((j) => ({ id: j.id, postId: j.post_id, accountId: j.social_account_id, accountName: j.account_name, platform: j.platform, status: j.status, at: new Date(j.at).toISOString(), localAt: localIso(j.at, q.timezone), title: j.title, preview: j.preview }));
      const days: Record<string, typeof events> = {};
      for (const e of events) (days[localDate(e.at, q.timezone)] ??= []).push(e);
      return { range: { from: from.toISOString(), to: to.toISOString(), timezone: q.timezone }, truncated: jobs.rows.length > LIMIT, events, days, unscheduledDrafts: drafts.rows.map((d) => ({ postId: d.id, title: d.title, preview: d.preview, createdAt: d.created_at })) };
    },

    // ---- bulk: every item is processed independently, in its own transaction. One failure never affects the others.
    async bulkCreate(a: Actor, workspaceId: string, posts: Parameters<ContentService["create"]>[2][]) {
      return settle(posts, (p) => content.create(a, workspaceId, p), "post");
    },
    async bulkSchedule(a: Actor, workspaceId: string, items: (When & { postId: string; accountIds?: string[] | undefined; allowConflicts?: boolean | undefined })[]) {
      return settle(items, (i) => service.schedule(a, workspaceId, i.postId, i), "schedule");
    },
    async bulkCancel(a: Actor, workspaceId: string, ids: string[]) {
      return settle(ids, async (id) => { await publishing.cancel(a, workspaceId, id); return { id }; }, "cancel");
    },
    async bulkStatus(a: Actor, workspaceId: string, ids: string[]) {
      await workspaces.authorize(a.id, workspaceId, "content:read");
      const rows = new Map((await repo.statuses(db, workspaceId, ids)).rows.map((r) => [r.id, r]));
      return ids.map((id) => ({ id, found: rows.has(id), ...(rows.get(id) ? { status: rows.get(id)!.status, platform: rows.get(id)!.platform, failureKind: rows.get(id)!.failure_kind, url: rows.get(id)!.external_url } : {}) }));
    },
  };
  return service;
}
export type SchedulingService = ReturnType<typeof createSchedulingService>;

async function settle<I, O>(items: I[], fn: (i: I) => Promise<O>, label: string) {
  const results: ({ index: number; ok: true; data: O } | { index: number; ok: false; error: { code: string; message: string; details?: unknown } })[] = [];
  for (const [index, item] of items.entries()) {
    try { results.push({ index, ok: true, data: await fn(item) }); }
    catch (e) {
      const err = e instanceof AppError ? { code: e.code, message: e.message, details: e.details } : e && typeof e === "object" && "issues" in e ? { code: "VALIDATION_ERROR", message: `Invalid ${label}`, details: (e as { issues: unknown }).issues } : { code: "INTERNAL", message: `Could not process ${label}` };
      results.push({ index, ok: false, error: err });
    }
  }
  return { total: items.length, succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
}
