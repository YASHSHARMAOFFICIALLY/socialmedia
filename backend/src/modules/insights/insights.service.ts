import type { Db } from "../../infrastructure/database/db.js";
import { badRequest } from "../../shared/errors/errors.js";
import { isValidTimeZone } from "../../shared/utils/timezone.js";
import type { AnalyticsService } from "../analytics/analytics.service.js";
import { defaultRange } from "../analytics/analytics.service.js";
import type { Actor, WorkspaceService } from "../workspaces/workspace.service.js";
import { insightsRepository as repo } from "./insights.repository.js";
import { recommend, rulesProvider, type Dataset, type InsightProvider } from "./insights.rules.js";

const day = (d: Date) => d.toISOString().slice(0, 10);
const shift = (date: string, days: number) => day(new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000));

export function createInsightsService(deps: { db: Db; workspaces: WorkspaceService; analytics: AnalyticsService; providers?: InsightProvider[] }) {
  const { db, workspaces } = deps;
  const providers = deps.providers ?? [rulesProvider];   // seam: append an AI-backed provider here later; the core never depends on one

  async function dataset(workspaceId: string, q: { from?: string | undefined; to?: string | undefined; timezone: string }): Promise<Dataset> {
    const r = { ...defaultRange(), ...(q.from ? { from: q.from } : {}), ...(q.to ? { to: q.to } : {}) };
    if (r.from > r.to) throw badRequest("`from` must not be after `to`");
    if (!isValidTimeZone(q.timezone)) throw badRequest("Unknown time zone");
    const today = day(new Date());
    const recent = { from: shift(today, -6), to: today }, previous = { from: shift(today, -13), to: shift(today, -7) };
    const [posts, published, gA, gB, overview] = await Promise.all([
      repo.posts(db, workspaceId, r.from, r.to), repo.published(db, workspaceId, r.from, r.to),
      repo.gain(db, workspaceId, recent.from, recent.to), repo.gain(db, workspaceId, previous.from, previous.to),
      deps.analytics.internal.overviewData(workspaceId, r),
    ]);
    const platforms = [...new Set([...gA, ...gB].map((g) => g.platform))];
    return {
      range: r, timezone: q.timezone, posts, published,
      interactionGain: platforms.map((p) => ({ platform: p, a: gA.find((g) => g.platform === p)?.gain != null ? Number(gA.find((g) => g.platform === p)!.gain) : null, b: gB.find((g) => g.platform === p)?.gain != null ? Number(gB.find((g) => g.platform === p)!.gain) : null })),
      gainWindows: { recent, previous },
      followers: overview.platforms.filter((p) => p.followers).map((p) => ({ platform: p.platform, latest: p.followers!.latest, change: p.followers!.change })),
    };
  }

  async function run(a: Actor, workspaceId: string, q: { from?: string | undefined; to?: string | undefined; timezone: string }) {
    await workspaces.authorize(a.id, workspaceId, "analytics:read");
    const d = await dataset(workspaceId, q);
    const results = await Promise.all(providers.map(async (p) => { try { return await p(d); } catch { return { insights: [], skipped: [{ type: "provider", reason: "An insight provider failed and was skipped." }] }; } }));
    const insights = results.flatMap((r) => r.insights), skipped = results.flatMap((r) => r.skipped);
    return { range: d.range, timezone: d.timezone, postsAnalyzed: d.posts.filter((p) => p.interactions !== null).length, insights, skipped, recommendations: recommend(insights) };
  }
  return {
    insights: run,
    async recommendations(a: Actor, workspaceId: string, q: { from?: string | undefined; to?: string | undefined; timezone: string }) {
      const r = await run(a, workspaceId, q);
      return { range: r.range, recommendations: r.recommendations, note: r.recommendations.length ? "Suggestions come only from insights that met their evidence thresholds." : "Not enough evidence for any recommendation yet. See `skipped` on /insights for what is missing." };
    },
  };
}
export type InsightsService = ReturnType<typeof createInsightsService>;
