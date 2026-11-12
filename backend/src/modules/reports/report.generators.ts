import type { Db } from "../../infrastructure/database/db.js";
import { analyticsRepository } from "../analytics/analytics.repository.js";
import { engagementRate } from "../analytics/analytics.normalizer.js";
import type { AnalyticsService, Grain } from "../analytics/analytics.service.js";
import type { Cell } from "./csv.js";

export const REPORT_TYPES = ["post_performance", "account_performance", "campaign_analytics", "platform_comparison", "historical_performance"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
export interface ReportParams { from: string; to: string; platform?: string | undefined; campaignId?: string | undefined; grain?: Grain | undefined }
export const MAX_ROWS = 50_000;
export interface Table { header: string[]; rows: Cell[][] }

const METRICS = ["impressions", "views", "reach", "likes", "comments", "shares", "reposts", "quotes", "saves", "bookmarks", "profile_visits", "interactions"];
const num = (s: string | null | undefined) => (s == null ? null : Number(s));

export async function generate(type: ReportType, ws: string, p: ReportParams, deps: { db: Db; analytics: AnalyticsService }): Promise<Table> {
  const range = { from: p.from, to: p.to };
  switch (type) {
    case "post_performance": {
      const rows = (await analyticsRepository.postsWide(deps.db, ws, { ...range, platform: p.platform, campaignId: p.campaignId, limit: MAX_ROWS * 15 })).rows;
      const byJob = new Map<string, { meta: (typeof rows)[number]; m: Record<string, number | null> }>();
      for (const r of rows) { const e = byJob.get(r.job_id) ?? { meta: r, m: {} }; if (r.metric_key) e.m[r.metric_key] = num(r.last_value); byJob.set(r.job_id, e); }
      const header = ["published_at", "platform", "account", "post", "url", ...METRICS, "engagement_rate", "engagement_rate_denominator"];
      return { header, rows: [...byJob.values()].slice(0, MAX_ROWS + 1).map(({ meta, m }) => { const er = engagementRate(m); return [new Date(meta.published_at).toISOString(), meta.platform, meta.account_name, meta.title || meta.preview, meta.external_url, ...METRICS.map((k) => m[k] ?? null), er ? Number(er.rate.toFixed(6)) : null, er?.denominator ?? null]; }) };
    }
    case "account_performance": {
      const o = await deps.analytics.internal.overviewData(ws, range, p.platform);
      const accounts = (await analyticsRepository.accounts(deps.db, ws, p.platform)).rows;
      const growth = await deps.analytics.internal.followerGrowth(ws, "day", range, p.platform);
      return {
        header: ["platform", "account", "status", "followers_latest", "followers_change", "posts_published_in_range", "posts_with_analytics", "platform_interactions_total", "platform_engagement_rate", "engagement_rate_denominator"],
        rows: accounts.map((a) => {
          const pl = o.platforms.find((x) => x.platform === a.platform);
          const g = growth.perAccount.find((x) => x.accountId === a.id);
          return [a.platform, a.display_name, a.status, g?.latest ?? null, g?.growth ?? null, pl?.posts.tracked ?? 0, pl?.posts.collected ?? 0, pl?.metrics.interactions?.total ?? null, pl?.engagementRate ? Number(pl.engagementRate.rate.toFixed(6)) : null, pl?.engagementRate?.denominator ?? null];
        }),
      };
    }
    case "campaign_analytics": {
      const camps = (await deps.db.query<{ id: string; name: string }>("SELECT id, name FROM campaigns WHERE workspace_id = $1 AND ($2::uuid IS NULL OR id = $2) ORDER BY created_at", [ws, p.campaignId ?? null])).rows;
      const rows: Cell[][] = [];
      for (const c of camps) {
        const o = await deps.analytics.internal.overviewData(ws, range, p.platform, undefined, c.id);
        for (const pl of o.platforms) rows.push([c.name, pl.platform, pl.posts.tracked, pl.posts.collected, ...METRICS.map((k) => pl.metrics[k]?.total ?? null), pl.engagementRate ? Number(pl.engagementRate.rate.toFixed(6)) : null, pl.engagementRate?.denominator ?? null]);
      }
      return { header: ["campaign", "platform", "posts_published", "posts_with_analytics", ...METRICS, "engagement_rate", "engagement_rate_denominator"], rows };
    }
    case "platform_comparison": {
      const o = await deps.analytics.internal.overviewData(ws, range, p.platform);
      const defs = new Map((await analyticsRepository.definitions(deps.db)).rows.map((d) => [d.key, d]));
      const rows: Cell[][] = [];
      for (const pl of o.platforms) {
        for (const [k, v] of Object.entries(pl.metrics)) rows.push([pl.platform, k, v.total, v.postsReporting, v.postsUnavailable, defs.get(k)?.comparable ? "yes" : "no"]);
        if (pl.followers) rows.push([pl.platform, "followers", pl.followers.latest, pl.followers.accountsReporting, 0, "yes"]);
      }
      return { header: ["platform", "metric", "total", "posts_reporting", "posts_unavailable", "comparable_across_platforms"], rows };
    }
    case "historical_performance": {
      const grain = p.grain ?? "day";
      const rows: Cell[][] = [];
      for (const metric of ["interactions", "views", "likes"]) {
        const s = await deps.analytics.internal.seriesFor(ws, metric, grain, range, p.platform);
        for (const [platform, pts] of Object.entries(s.byPlatform)) for (const pt of pts) rows.push([pt.bucket, platform, metric, "gained_in_period", pt.value, pt.partial]);
      }
      const f = await deps.analytics.internal.followerGrowth(ws, grain, range, p.platform);
      for (const [platform, pts] of Object.entries(f.byPlatform)) for (const pt of pts) rows.push([pt.bucket, platform, "followers", "level", pt.value, pt.partial]);
      return { header: ["period_start", "platform", "metric", "kind", "value", "partial"], rows: rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1]))) };
    }
  }
}
