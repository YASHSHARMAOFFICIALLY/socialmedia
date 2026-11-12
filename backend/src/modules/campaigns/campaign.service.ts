import { z } from "zod";
import type { Db } from "../../infrastructure/database/db.js";
import { AppError, badRequest, notFound } from "../../shared/errors/errors.js";
import { decodeCursor, page } from "../../shared/utils/pagination.js";
import { auditRepository } from "../audit/audit.repository.js";
import type { AnalyticsService } from "../analytics/analytics.service.js";
import { defaultRange } from "../analytics/analytics.service.js";
import type { Actor, WorkspaceService } from "../workspaces/workspace.service.js";
import { campaignRepository as repo, type CampaignRow } from "./campaign.repository.js";

const cursorSchema = z.object({ createdAt: z.string(), id: z.string() });
const view = (c: CampaignRow) => ({ id: c.id, name: c.name, description: c.description, startDate: c.start_date, endDate: c.end_date, status: c.status, createdAt: c.created_at });

export function createCampaignService(deps: { db: Db; workspaces: WorkspaceService; analytics: AnalyticsService }) {
  const { db, workspaces } = deps;
  const audit = (q: Db | Parameters<typeof auditRepository.record>[0], a: Actor, ws: string, action: string, id: string, metadata?: object) =>
    auditRepository.record(q, { workspaceId: ws, actorId: a.id, action, entityType: "campaign", entityId: id, ...(metadata ? { metadata: metadata as Record<string, unknown> } : {}), ...(a.requestId ? { requestId: a.requestId } : {}) });
  const load = async (q: Parameters<typeof repo.get>[0], ws: string, id: string) => { const c = await repo.get(q, ws, id); if (!c) throw notFound("Campaign"); return c; };

  /** Default window: the campaign's own dates, else the last 90 days. */
  const windowOf = (c: CampaignRow, q: { from?: string | undefined; to?: string | undefined }) => {
    const d = defaultRange();
    const fallbackFrom = c.start_date ?? new Date(Date.now() - 89 * 86_400_000).toISOString().slice(0, 10);
    return { from: q.from ?? fallbackFrom, to: q.to ?? c.end_date ?? d.to };
  };

  return {
    async create(a: Actor, workspaceId: string, i: { name: string; description?: string | undefined; startDate?: string | undefined; endDate?: string | undefined }) {
      await workspaces.authorize(a.id, workspaceId, "campaigns:write");
      const c = await repo.create(db, { workspaceId, userId: a.id, ...i });
      await audit(db, a, workspaceId, "campaign.created", c.id);
      return view(c);
    },
    async list(a: Actor, workspaceId: string, f: { limit: number; cursor?: string | undefined; status?: string | undefined }) {
      await workspaces.authorize(a.id, workspaceId, "campaigns:read");
      const rows = (await repo.list(db, workspaceId, { ...f, after: decodeCursor(f.cursor, cursorSchema) })).rows;
      return page(rows.map((r) => ({ ...view(r), createdAtRaw: r.created_at, postCount: r.post_count })), f.limit, (r) => ({ createdAt: r.createdAtRaw, id: r.id }));
    },
    async get(a: Actor, workspaceId: string, id: string) {
      await workspaces.authorize(a.id, workspaceId, "campaigns:read");
      const c = await load(db, workspaceId, id);
      const [posts, status] = await Promise.all([repo.posts(db, workspaceId, id), repo.publishingStatus(db, workspaceId, id)]);
      const publishing: Record<string, Record<string, number>> = {};
      for (const s of status.rows) (publishing[s.platform] ??= {})[s.status] = s.n;
      return { ...view(c), postCount: posts.rows.length, posts: posts.rows.map((p) => ({ id: p.id, title: p.title, preview: p.preview, status: p.status, addedAt: p.added_at })), publishing };
    },
    async update(a: Actor, workspaceId: string, id: string, patch: Record<string, unknown>) {
      await workspaces.authorize(a.id, workspaceId, "campaigns:write");
      const current = await load(db, workspaceId, id);
      const startDate = "startDate" in patch ? (patch.startDate as string | null) : current.start_date, endDate = "endDate" in patch ? (patch.endDate as string | null) : current.end_date;
      if (startDate && endDate && endDate < startDate) throw badRequest("endDate must not be before startDate");
      const c = await repo.update(db, workspaceId, id, patch, new Set(Object.keys(patch)));
      await audit(db, a, workspaceId, "campaign.updated", id, patch);
      return view(c!);
    },
    /** Adds posts (moving them if they belonged to another campaign — reported back so it is never silent). */
    async addPosts(a: Actor, workspaceId: string, id: string, postIds: string[]) {
      return db.tx(async (q) => {
        await workspaces.authorize(a.id, workspaceId, "campaigns:write", q);
        await load(q, workspaceId, id);
        const unique = [...new Set(postIds)];
        const found = await repo.existingPosts(q, workspaceId, unique);
        if (found.length !== unique.length) throw badRequest("One or more posts were not found in this workspace");
        const moved = found.filter((p) => p.campaign_id && p.campaign_id !== id).map((p) => ({ postId: p.id, fromCampaignId: p.campaign_id }));
        for (const p of unique) await repo.addPost(q, workspaceId, id, p);
        await audit(q, a, workspaceId, "campaign.posts_added", id, { count: unique.length, moved: moved.length });
        return { added: unique.length, moved };
      });
    },
    async removePost(a: Actor, workspaceId: string, id: string, postId: string) {
      await workspaces.authorize(a.id, workspaceId, "campaigns:write");
      if (!(await repo.removePost(db, workspaceId, id, postId))) throw notFound("Campaign post");
      await audit(db, a, workspaceId, "campaign.post_removed", id, { postId });
    },

    /** Campaign-level analytics: same normalization rules as the dashboard, restricted to this campaign's posts. */
    async performance(a: Actor, workspaceId: string, id: string, q: { from?: string | undefined; to?: string | undefined; grain?: "day" | "week" | "month" | undefined }) {
      await workspaces.authorize(a.id, workspaceId, "analytics:read");
      const c = await load(db, workspaceId, id);
      const r = windowOf(c, q);
      if (r.from > r.to) throw badRequest("`from` must not be after `to`");
      const [o, trend, status] = await Promise.all([
        deps.analytics.internal.overviewData(workspaceId, r, undefined, undefined, id),
        deps.analytics.internal.seriesFor(workspaceId, "interactions", q.grain ?? "day", r, undefined, undefined, id),
        repo.publishingStatus(db, workspaceId, id),
      ]);
      const contribution = o.totals.find((t) => t.key === "interactions")?.perPlatform ?? {};
      const sum = Object.values(contribution).reduce((s, v) => s + v, 0);
      return {
        campaign: view(c), range: r,
        publishing: status.rows.reduce<Record<string, Record<string, number>>>((m, s) => { (m[s.platform] ??= {})[s.status] = s.n; return m; }, {}),
        platforms: o.platforms, totals: o.totals, notSummed: o.notSummed,
        platformContribution: Object.entries(contribution).map(([platform, interactions]) => ({ platform, interactions, share: sum > 0 ? interactions / sum : null })),
        interactionsTrend: trend,
      };
    },

    async compare(a: Actor, workspaceId: string, q: { ids: string[]; from?: string | undefined; to?: string | undefined }) {
      await workspaces.authorize(a.id, workspaceId, "analytics:read");
      const out = [];
      for (const id of q.ids) {
        const c = await load(db, workspaceId, id).catch(() => { throw new AppError(404, "NOT_FOUND", `Campaign ${id} not found`); });
        const r = windowOf(c, q);
        const o = await deps.analytics.internal.overviewData(workspaceId, r, undefined, undefined, id);
        out.push({ campaign: view(c), range: r, platforms: o.platforms.map((p) => ({ platform: p.platform, posts: p.posts, metrics: p.metrics, engagementRate: p.engagementRate })), totals: o.totals });
      }
      return { campaigns: out, note: "Campaigns may cover different date ranges. Totals include only metrics that are comparable across platforms; everything else is per platform." };
    },
  };
}
export type CampaignService = ReturnType<typeof createCampaignService>;
