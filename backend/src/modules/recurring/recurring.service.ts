import { z } from "zod";
import type { Db } from "../../infrastructure/database/db.js";
import type { Logger } from "../../infrastructure/logger/logger.js";
import { AppError, badRequest, notFound } from "../../shared/errors/errors.js";
import { decodeCursor, page } from "../../shared/utils/pagination.js";
import { auditRepository } from "../audit/audit.repository.js";
import type { ContentService } from "../content/content.service.js";
import type { NotificationService } from "../notifications/notification.service.js";
import type { SchedulingService } from "../scheduling/scheduling.service.js";
import type { Actor, WorkspaceService } from "../workspaces/workspace.service.js";
import { occurrenceAt, type Rule } from "./rrule.js";
import { recurringRepository as repo, type SeriesRow } from "./recurring.repository.js";

const cursorSchema = z.object({ createdAt: z.string(), id: z.string() });
const LOOKAHEAD_H = 24, MAX_PER_SERIES_PER_RUN = 5, MISSED_AFTER_MS = 6 * 3600_000;
const ruleOf = (s: SeriesRow): Rule => ({ frequency: s.frequency, interval: s.interval_n, startLocal: s.start_local, timezone: s.timezone, count: s.max_count, untilDate: s.until_date });
const view = (s: SeriesRow) => ({ id: s.id, templatePostId: s.template_post_id, frequency: s.frequency, interval: s.interval_n, startLocal: s.start_local, timezone: s.timezone, count: s.max_count, untilDate: s.until_date, accountIds: s.account_ids, status: s.status, occurrencesCreated: s.next_no, nextAt: s.next_at, createdAt: s.created_at });

export function createRecurringService(deps: { db: Db; workspaces: WorkspaceService; content: ContentService; scheduling: SchedulingService; notifications: NotificationService; log: Logger }) {
  const { db, workspaces, content, scheduling, notifications, log } = deps;

  return {
    async create(a: Actor, workspaceId: string, postId: string, i: { frequency: "daily" | "weekly" | "monthly"; interval: number; startLocal: string; timezone: string; count?: number | undefined; untilDate?: string | undefined; accountIds?: string[] | undefined }) {
      return db.tx(async (q) => {
        await workspaces.authorize(a.id, workspaceId, "publish:create", q);
        const d = await content.validateForPublish(workspaceId, postId, q).catch(() => { throw notFound("Post"); });
        if (d.post.status !== "draft") throw new AppError(409, "POST_NOT_EDITABLE", "Only a draft can be the template of a recurring series");
        const chosen = d.variants.filter((v) => !i.accountIds || i.accountIds.includes(v.social_account_id));
        if (!chosen.length || (i.accountIds && chosen.length !== new Set(i.accountIds).size)) throw badRequest("The template needs at least one matching destination");
        const bad = d.report.variants.filter((v) => chosen.some((c) => c.social_account_id === v.accountId) && !v.valid);
        if (bad.length) throw new AppError(422, "POST_INVALID", "Fix the template's content errors first", { variants: bad });
        const rule: Rule = { ...i, count: i.count ?? null, untilDate: i.untilDate ?? null };
        const first = occurrenceAt(rule, 0);
        if (!first) throw badRequest("The series has no occurrences (check startLocal, count and untilDate)");
        if (first.getTime() < Date.now() + 60_000) throw badRequest("The first occurrence must be at least a minute in the future");
        const s = await repo.create(q, { workspaceId, postId, ...i, nextAt: first, userId: a.id });
        await auditRepository.record(q, { workspaceId, actorId: a.id, action: "series.created", entityType: "series", entityId: s.id, ...(a.requestId ? { requestId: a.requestId } : {}) });
        return view(s);
      });
    },
    async list(a: Actor, workspaceId: string, f: { limit: number; cursor?: string | undefined; status?: string | undefined }) {
      await workspaces.authorize(a.id, workspaceId, "calendar:read");
      const rows = (await repo.list(db, workspaceId, { ...f, after: decodeCursor(f.cursor, cursorSchema) })).rows;
      const p = page(rows, f.limit, (r) => ({ createdAt: r.created_at, id: r.id }));
      return { items: p.items.map(view), nextCursor: p.nextCursor };
    },
    async get(a: Actor, workspaceId: string, id: string) {
      await workspaces.authorize(a.id, workspaceId, "calendar:read");
      const s = await repo.get(db, workspaceId, id);
      if (!s) throw notFound("Series");
      return { ...view(s), occurrences: (await repo.occurrences(db, workspaceId, id)).rows.map((o) => ({ number: o.occurrence_no, scheduledAt: o.scheduled_at, postId: o.post_id, status: o.status, error: o.error })) };
    },
    async setStatus(a: Actor, workspaceId: string, id: string, status: "active" | "paused") {
      await workspaces.authorize(a.id, workspaceId, "publish:create");
      const s = await repo.get(db, workspaceId, id);
      if (!s) throw notFound("Series");
      if (s.status === "ended") throw new AppError(409, "SERIES_ENDED", "This series has ended");
      await repo.setStatus(db, workspaceId, id, status);
      return { id, status };
    },
    /** Ends the series. Occurrences already scheduled stay scheduled unless `cancelScheduled` is set. */
    async end(a: Actor, workspaceId: string, id: string, cancelScheduled: boolean) {
      await workspaces.authorize(a.id, workspaceId, "publish:cancel");
      const s = await repo.get(db, workspaceId, id);
      if (!s) throw notFound("Series");
      await db.query("UPDATE recurring_series SET status = 'ended', next_at = NULL WHERE workspace_id = $1 AND id = $2", [workspaceId, id]);
      let cancelled = 0;
      if (cancelScheduled)
        for (const o of (await repo.occurrences(db, workspaceId, id)).rows.filter((x) => x.status === "scheduled" && x.post_id)) {
          try { await scheduling.cancelSchedule(a, workspaceId, o.post_id!); cancelled++; } catch { /* already published or cancelled */ }
        }
      await auditRepository.record(db, { workspaceId, actorId: a.id, action: "series.ended", entityType: "series", entityId: id, metadata: { cancelled }, ...(a.requestId ? { requestId: a.requestId } : {}) });
      return { id, status: "ended" as const, cancelledOccurrences: cancelled };
    },

    // ---- background (cron)
    /**
     * 1) turn series whose next occurrence is within 24 h into occurrence rows (idempotent: PK per occurrence), 2) process pending
     * occurrences: copy the template as it is NOW and schedule the copy. Both steps are safe to repeat and to run concurrently.
     */
    async sweep() {
      const r = { materialized: 0, scheduled: 0, failed: 0, skipped: 0 };
      await db.tx(async (q) => {
        for (const s of (await repo.due(q, LOOKAHEAD_H, 20)).rows) {
          let cur = s;
          for (let k = 0; k < MAX_PER_SERIES_PER_RUN && cur.next_at && new Date(cur.next_at).getTime() <= Date.now() + LOOKAHEAD_H * 3600_000; k++) {
            const at = new Date(cur.next_at);
            if (await repo.claimOccurrence(q, cur, at)) r.materialized++;
            const nextNo = cur.next_no + 1, nextAt = occurrenceAt(ruleOf(s), nextNo);
            await repo.advance(q, cur.id, nextNo, nextAt);
            cur = { ...cur, next_no: nextNo, next_at: nextAt ? nextAt.toISOString() : null };
          }
        }
      });
      const claimed = await db.tx((q) => repo.claimPending(q, 20)).then((x) => x.rows);
      for (const o of claimed) {
        const s = await repo.get(db, o.workspace_id, o.series_id);
        const done = async (status: string, error?: string) => { await db.tx((q) => repo.finishOccurrence(q, o.series_id, o.occurrence_no, status, error)); };
        if (!s) { continue; }
        const actor: Actor = { id: s.created_by, email: "" };
        try {
          if (s.status === "paused") { await done("skipped", "series paused"); r.skipped++; continue; }
          let at = new Date(o.scheduled_at);
          if (at.getTime() < Date.now() + 60_000) {
            if (Date.now() - at.getTime() > MISSED_AFTER_MS) { await done("skipped", "occurrence time passed more than 6 hours ago"); r.skipped++; continue; }
            at = new Date(Date.now() + 90_000);        // slightly late: publish as soon as allowed
          }
          let postId = o.post_id;
          if (!postId) { postId = (await content.duplicate(actor, o.workspace_id, s.template_post_id, { keepTitle: true })).id; await db.tx((q) => repo.setOccurrencePost(q, o.series_id, o.occurrence_no, postId!)); }
          await scheduling.schedule(actor, o.workspace_id, postId, { scheduledAt: at.toISOString(), timezone: s.timezone, accountIds: s.account_ids ?? undefined, allowConflicts: true });
          await done("scheduled"); r.scheduled++;
        } catch (e) {
          const msg = e instanceof AppError ? `${e.code}: ${e.message}` : "unexpected error";
          log.warn({ seriesId: o.series_id, occurrence: o.occurrence_no, err: (e as Error).message }, "recurring occurrence failed");
          await done("failed", msg).catch((err) => log.error({ err }, "could not record occurrence failure")); r.failed++;
          await db.tx((q) => notifications.notify(q, { workspaceId: o.workspace_id, userIds: [s.created_by], type: "series_occurrence_failed", title: "A recurring post could not be scheduled", body: `Occurrence ${o.occurrence_no + 1} for ${new Date(o.scheduled_at).toISOString()}: ${msg}`, data: { seriesId: o.series_id, occurrence: o.occurrence_no }, ref: `series:${o.series_id}:${o.occurrence_no}` })).catch((err) => log.error({ err }, "could not notify about occurrence failure"));
        }
      }
      return r;
    },
  };
}
export type RecurringService = ReturnType<typeof createRecurringService>;
