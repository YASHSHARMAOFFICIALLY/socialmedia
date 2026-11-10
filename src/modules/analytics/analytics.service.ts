import { createHash } from "node:crypto";
import type { Db } from "../../infrastructure/database/db.js";
import type { CacheStore } from "../../infrastructure/cache/cache.js";
import type { AdapterRegistry } from "../../integrations/core/registry.js";
import { AppError, badRequest, notFound } from "../../shared/errors/errors.js";
import type { Actor, WorkspaceService } from "../workspaces/workspace.service.js";
import { carryForwardSum, sumSeries } from "./analytics.aggregator.js";
import { engagementRate } from "./analytics.normalizer.js";
import { analyticsRepository as repo } from "./analytics.repository.js";

export interface Range { from: string; to: string }            // inclusive UTC dates, YYYY-MM-DD
export type Grain = "day" | "week" | "month";
const CACHE_TTL_S = 300;
const day = (d: Date) => d.toISOString().slice(0, 10);
const num = (s: string | null | undefined) => (s == null ? null : Number(s));

export function defaultRange(now = new Date()): Range {
  const to = day(now), from = new Date(now.getTime() - 29 * 86_400_000);
  return { from: day(from), to };
}
export function bucketFloor(date: string, grain: Grain): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (grain === "week") d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));       // ISO week starts Monday
  if (grain === "month") d.setUTCDate(1);
  return day(d);
}
function checkRange(r: Range) {
  if (r.from > r.to) throw badRequest("`from` must not be after `to`");
  if ((new Date(r.to).getTime() - new Date(r.from).getTime()) / 86_400_000 > 366) throw badRequest("Range is limited to 366 days");
}

export function createAnalyticsService(deps: { db: Db; workspaces: WorkspaceService; registry: AdapterRegistry; cache: CacheStore }) {
  const { db, workspaces, registry, cache } = deps;

  /** Cache keys carry the workspace's data version, so a new collection invalidates everything without a purge. */
  async function cached<T extends object>(workspaceId: string, name: string, params: unknown, compute: () => Promise<T>): Promise<T & { cached?: boolean }> {
    const version = await repo.version(db, workspaceId);
    const key = `an:${workspaceId}:${version}:${name}:${createHash("sha1").update(JSON.stringify(params)).digest("hex")}`;
    try { const hit = await cache.get(key); if (hit !== undefined) return { ...(hit as T), cached: true }; } catch { /* cache is optional */ }
    const value = await compute();
    await cache.put(key, value, CACHE_TTL_S).catch(() => {});
    return value as T & { cached?: boolean };
  }

  /** The numbers behind the dashboard: per-platform sums of the latest value of each post (same platform => same definition => summable). */
  async function platformSummaries(workspaceId: string, r: Range, platform?: string, accountId?: string, campaignId?: string) {
    const [rows, targets, accounts, accountTargets, defs, followersNow, followersBase] = await Promise.all([
      repo.postLatest(db, workspaceId, { ...r, platform, accountId, campaignId }), repo.postTargets(db, workspaceId, { ...r, platform, accountId, campaignId }),
      repo.accounts(db, workspaceId, platform), repo.accountTargets(db, workspaceId, platform), repo.definitions(db),
      repo.accountLatest(db, workspaceId, "followers", r.to, platform, accountId), repo.accountBaseline(db, workspaceId, "followers", r.from, platform),
    ]);
    const caps = new Map(registry.list().map((p) => [p.platform, p]));
    const defMap = new Map(defs.rows.map((d) => [d.key, d]));
    const platforms = [...new Set([...accounts.rows.map((a) => a.platform), ...targets.rows.map((t) => t.platform)])].sort();

    return platforms.map((p) => {
      const mine = rows.rows.filter((x) => x.platform === p);
      const byMetric = new Map<string, { total: number; reporting: number; unavailable: number }>();
      const perTarget = new Map<string, Record<string, number | null>>();
      for (const x of mine) {
        const e = byMetric.get(x.metric_key) ?? { total: 0, reporting: 0, unavailable: 0 };
        const v = num(x.last_value);
        if (v === null) e.unavailable++; else { e.total += v; e.reporting++; }
        byMetric.set(x.metric_key, e);
        (perTarget.get(x.target_id) ?? perTarget.set(x.target_id, {}).get(x.target_id)!)[x.metric_key] = v;
      }
      // engagement rate: weighted by the denominator the platform actually provides (never mixing denominators)
      const rates = new Map<string, { n: number; d: number; posts: number }>();
      for (const m of perTarget.values()) { const er = engagementRate(m); if (er) { const e = rates.get(er.denominator) ?? { n: 0, d: 0, posts: 0 }; e.n += m.interactions!; e.d += m[er.denominator]!; e.posts++; rates.set(er.denominator, e); } }
      const best = [...rates.entries()].sort((a, b) => b[1].posts - a[1].posts)[0];
      const t = targets.rows.find((x) => x.platform === p);
      const caps_ = caps.get(p as never);
      const fNow = followersNow.rows.filter((x) => x.platform === p), fBase = followersBase.rows.filter((x) => x.platform === p);
      const followers = fNow.length ? {
        latest: fNow.reduce((s, x) => s + (num(x.last_value) ?? 0), 0), accountsReporting: fNow.length,
        change: fNow.every((x) => fBase.some((b) => b.social_account_id === x.social_account_id)) ? fNow.reduce((s, x) => s + (num(x.last_value) ?? 0) - (num(fBase.find((b) => b.social_account_id === x.social_account_id)!.last_value) ?? 0), 0) : null,
      } : null;
      return {
        platform: p,
        accounts: accounts.rows.filter((a) => a.platform === p).map((a) => ({ id: a.id, name: a.display_name, status: a.status, collection: accountTargets.rows.find((x) => x.social_account_id === a.id)?.status ?? "not_started" })),
        supported: { posts: caps_?.capabilities?.postAnalytics ?? false, accounts: caps_?.capabilities?.accountAnalytics ?? false, integrationAvailable: caps_?.available ?? false },
        posts: { tracked: t?.tracked ?? 0, collected: t?.collected ?? 0, notYetCollected: (t?.tracked ?? 0) - (t?.collected ?? 0), disabled: t?.disabled ?? 0, lastCollectedAt: t?.last_collected_at ?? null },
        metrics: Object.fromEntries([...byMetric.entries()].map(([k, v]) => [k, { label: defMap.get(k)?.label ?? k, unit: defMap.get(k)?.unit ?? "count", total: v.reporting ? v.total : null, postsReporting: v.reporting, postsUnavailable: v.unavailable }])),
        engagementRate: best ? { rate: best[1].n / best[1].d, denominator: best[0], postsIncluded: best[1].posts } : null,
        followers,
      };
    });
  }

  async function overviewData(workspaceId: string, r: Range, platform?: string, accountId?: string, campaignId?: string) {
    const [platforms, defs] = await Promise.all([platformSummaries(workspaceId, r, platform, accountId, campaignId), repo.definitions(db)]);
    // Cross-platform totals exist ONLY for metrics flagged comparable, and always travel with the per-platform values and a caveat.
    const totals = defs.rows.filter((d) => d.comparable).flatMap((d) => {
      const perPlatform: Record<string, number> = {};
      for (const p of platforms) {
        const v = d.key === "followers" ? p.followers?.latest : p.metrics[d.key]?.total;
        if (v != null) perPlatform[p.platform] = v;
      }
      if (!Object.keys(perPlatform).length) return [];
      return [{ key: d.key, label: d.label, total: Object.values(perPlatform).reduce((s, v) => s + v, 0), perPlatform, platformsIncluded: Object.keys(perPlatform), caveat: d.caveat }];
    });
    const present = new Set(platforms.flatMap((p) => Object.keys(p.metrics)));
    return {
      range: r, platforms, totals,
      notSummed: defs.rows.filter((d) => !d.comparable && present.has(d.key)).map((d) => ({ key: d.key, label: d.label, reason: "Defined differently on each platform; compare per platform only." })),
    };
  }

  return {
    /** For other modules (campaigns, reports): same numbers, same rules, no authorization (callers authorize). */
    internal: { overviewData, followerGrowth: (ws: string, grain: Grain, r: Range, platform?: string) => followerGrowth(ws, grain, r, platform), seriesFor: (ws: string, metric: string, grain: Grain, r: Range, platform?: string, accountId?: string, campaignId?: string) => seriesFor(ws, metric, grain, r, platform, accountId, campaignId) },
    async definitions(a: Actor, workspaceId: string) {
      await workspaces.authorize(a.id, workspaceId, "analytics:read");
      return (await repo.definitions(db)).rows;
    },

    /** How fresh the data is, per platform: when it was last collected and whether collection is failing. Never cached. */
    async syncStatus(a: Actor, workspaceId: string) {
      await workspaces.authorize(a.id, workspaceId, "analytics:read");
      const caps = new Map(registry.list().map((p) => [p.platform, p]));
      const rows = (await repo.syncStatus(db, workspaceId)).rows;
      const platforms = [...new Set(rows.map((r) => r.platform))].map((p) => {
        const c = caps.get(p as never);
        return {
          platform: p,
          supported: { posts: c?.capabilities?.postAnalytics ?? false, accounts: c?.capabilities?.accountAnalytics ?? false, integrationAvailable: c?.available ?? false },
          scopes: rows.filter((r) => r.platform === p).map((r) => ({ scope: r.scope, targets: r.targets, active: r.active, failing: r.failing, disabled: r.disabled, lastCollectedAt: r.last_collected_at })),
        };
      });
      return { asOf: new Date().toISOString(), platforms };
    },

    /** Cross-platform dashboard. */
    async overview(a: Actor, workspaceId: string, q: Partial<Range> & { platform?: string | undefined }) {
      await workspaces.authorize(a.id, workspaceId, "analytics:read");
      const r = { ...defaultRange(), ...stripUndefined(q) } as Range; checkRange(r);
      return cached(workspaceId, "overview", { r, p: q.platform }, () => overviewData(workspaceId, r, q.platform));
    },

    async platform(a: Actor, workspaceId: string, platform: string, q: Partial<Range> & { grain?: Grain | undefined }) {
      await workspaces.authorize(a.id, workspaceId, "analytics:read");
      const r = { ...defaultRange(), ...stripUndefined(q) } as Range; checkRange(r);
      return cached(workspaceId, "platform", { r, platform, g: q.grain }, async () => {
        const o = await overviewData(workspaceId, r, platform);
        const p = o.platforms[0];
        if (!p) throw notFound("Platform data");
        const grain = q.grain ?? "day";
        const trend = await seriesFor(workspaceId, "interactions", grain, r, platform);
        return { range: r, grain, platform: p, interactionsTrend: trend, topPosts: await topPosts(workspaceId, "interactions", r, platform, undefined, 5) };
      });
    },

    async account(a: Actor, workspaceId: string, accountId: string, q: Partial<Range> & { grain?: Grain | undefined }) {
      await workspaces.authorize(a.id, workspaceId, "analytics:read");
      const acct = (await repo.accounts(db, workspaceId)).rows.find((x) => x.id === accountId);
      if (!acct) throw notFound("Account");
      const r = { ...defaultRange(), ...stripUndefined(q) } as Range; checkRange(r);
      const grain = q.grain ?? "day";
      return cached(workspaceId, "account", { r, accountId, grain }, async () => {
        const [o, followers] = await Promise.all([overviewData(workspaceId, r, acct.platform, accountId), followerGrowth(workspaceId, grain, r, acct.platform, accountId)]);
        return { range: r, grain, account: { id: acct.id, name: acct.display_name, platform: acct.platform, status: acct.status }, summary: o.platforms[0] ?? null, followers, topPosts: await topPosts(workspaceId, "interactions", r, acct.platform, accountId, 5) };
      });
    },

    /** One post: every published destination, latest value of every metric WITH its availability, history, engagement rate. */
    async post(a: Actor, workspaceId: string, postId: string, q: { grain?: Grain | undefined }) {
      await workspaces.authorize(a.id, workspaceId, "analytics:read");
      const jobs = (await repo.jobsForPost(db, workspaceId, postId)).rows;
      const post = await db.query("SELECT 1 FROM posts WHERE workspace_id = $1 AND id = $2", [workspaceId, postId]);
      if (!post.rowCount) throw notFound("Post");
      return cached(workspaceId, "post", { postId, g: q.grain }, async () => {
        const defs = new Map((await repo.definitions(db)).rows.map((d) => [d.key, d]));
        const destinations = await Promise.all(jobs.map(async (j) => {
          const info = (await repo.postJob(db, workspaceId, j.id))!;
          const latest = (await repo.postLatestMetrics(db, workspaceId, j.id)).rows;
          const values: Record<string, number | null> = Object.fromEntries(latest.map((m) => [m.metric_key, num(m.value)]));
          const supported = registry.list().find((p) => p.platform === info.platform)?.capabilities?.postAnalytics ?? false;
          const range = { from: day(new Date(new Date(info.published_at ?? Date.now()).getTime() - 86_400_000)), to: day(new Date()) };
          const history = async (metric: string) => (await repo.aggregateRows(db, workspaceId, { scope: "post", metric, grain: q.grain ?? "day", from: bucketFloor(range.from, q.grain ?? "day"), to: range.to, jobId: j.id })).rows.map((x) => ({ bucket: x.bucket, value: num(x.last_value), change: num(x.delta) }));
          return {
            jobId: j.id, platform: info.platform, accountId: info.social_account_id, url: info.external_url, publishedAt: info.published_at,
            analytics: !supported ? { state: "unsupported" as const, reason: "This platform does not expose post analytics to this integration" }
              : latest.length === 0 ? { state: "not_yet_collected" as const, collection: info.target_status ?? "pending" }
              : { state: "collected" as const, collection: info.target_status, lastCollectedAt: info.last_collected_at, lastError: info.last_error },
            metrics: latest.map((m) => ({ key: m.metric_key, label: defs.get(m.metric_key)?.label ?? m.metric_key, value: num(m.value), availability: m.availability, originalName: m.original_name, definition: m.definition, components: m.components, collectedAt: m.collected_at })),
            engagementRate: engagementRate(values),
            history: { interactions: await history("interactions"), views: await history("views") },
          };
        }));
        return { postId, destinations };
      });
    },

    async trends(a: Actor, workspaceId: string, q: Partial<Range> & { metric: string; grain?: Grain | undefined; platform?: string | undefined; accountId?: string | undefined }) {
      await workspaces.authorize(a.id, workspaceId, "analytics:read");
      const r = { ...defaultRange(), ...stripUndefined(q) } as Range; checkRange(r);
      const grain = q.grain ?? "day";
      const def = (await repo.definitions(db)).rows.find((d) => d.key === q.metric);
      if (!def) throw badRequest(`Unknown metric '${q.metric}'`);
      return cached(workspaceId, "trends", { r, ...q }, async () => ({
        range: r, grain, metric: q.metric, comparable: def.comparable, caveat: def.caveat,
        ...(q.metric === "followers" ? await followerGrowth(workspaceId, grain, r, q.platform, q.accountId) : await seriesFor(workspaceId, q.metric, grain, r, q.platform, q.accountId)),
      }));
    },

    async comparePlatforms(a: Actor, workspaceId: string, q: Partial<Range>) {
      await workspaces.authorize(a.id, workspaceId, "analytics:read");
      const r = { ...defaultRange(), ...stripUndefined(q) } as Range; checkRange(r);
      return cached(workspaceId, "compare-platforms", { r }, async () => {
        const [o, defs] = await Promise.all([overviewData(workspaceId, r), repo.definitions(db)]);
        const keys = [...new Set(o.platforms.flatMap((p) => Object.keys(p.metrics)))];
        return {
          range: r,
          metrics: keys.map((k) => { const d = defs.rows.find((x) => x.key === k); return { key: k, label: d?.label ?? k, comparable: d?.comparable ?? false, note: d?.comparable ? d.caveat : "Not directly comparable: each platform defines this metric differently.", values: Object.fromEntries(o.platforms.filter((p) => p.metrics[k]).map((p) => [p.platform, p.metrics[k]])) }; }),
          engagementRate: Object.fromEntries(o.platforms.filter((p) => p.engagementRate).map((p) => [p.platform, p.engagementRate])),
          followers: Object.fromEntries(o.platforms.filter((p) => p.followers).map((p) => [p.platform, p.followers])),
          totals: o.totals,
        };
      });
    },

    /** Two date ranges side by side; change is null when either side has no data (never 0 by default). */
    async compareRanges(a: Actor, workspaceId: string, q: { aFrom: string; aTo: string; bFrom: string; bTo: string; platform?: string | undefined }) {
      await workspaces.authorize(a.id, workspaceId, "analytics:read");
      const A = { from: q.aFrom, to: q.aTo }, B = { from: q.bFrom, to: q.bTo }; checkRange(A); checkRange(B);
      return cached(workspaceId, "compare-ranges", q, async () => {
        const [oa, ob] = await Promise.all([overviewData(workspaceId, A, q.platform), overviewData(workspaceId, B, q.platform)]);
        const platforms = [...new Set([...oa.platforms, ...ob.platforms].map((p) => p.platform))].sort();
        return {
          a: A, b: B,
          platforms: platforms.map((p) => {
            const pa = oa.platforms.find((x) => x.platform === p), pb = ob.platforms.find((x) => x.platform === p);
            const keys = [...new Set([...Object.keys(pa?.metrics ?? {}), ...Object.keys(pb?.metrics ?? {})])];
            return { platform: p, metrics: Object.fromEntries(keys.map((k) => { const x = pa?.metrics[k]?.total ?? null, y = pb?.metrics[k]?.total ?? null; return [k, { a: x, b: y, change: x !== null && y !== null ? y - x : null, changePct: x !== null && y !== null && x !== 0 ? (y - x) / x : null }]; })) };
          }),
        };
      });
    },

    async topPosts(a: Actor, workspaceId: string, q: Partial<Range> & { metric: string; platform?: string | undefined; accountId?: string | undefined; limit: number }) {
      await workspaces.authorize(a.id, workspaceId, "analytics:read");
      const r = { ...defaultRange(), ...stripUndefined(q) } as Range; checkRange(r);
      return cached(workspaceId, "top", { r, ...q }, async () => ({ range: r, metric: q.metric, platform: q.platform ?? null, posts: await topPosts(workspaceId, q.metric, r, q.platform, q.accountId, q.limit) }));
    },
  };

  // ---- helpers (closed over db/registry)
  async function seriesFor(workspaceId: string, metric: string, grain: Grain, r: Range, platform?: string, accountId?: string, campaignId?: string) {
    const rows = (await repo.aggregateRows(db, workspaceId, { scope: "post", metric, grain, from: bucketFloor(r.from, grain), to: r.to, platform, accountId, campaignId })).rows;
    const pts = (p?: string) => sumSeries(rows.filter((x) => !p || x.platform === p).map((x) => ({ bucket: x.bucket, value: num(x.delta) })));
    const platforms = [...new Set(rows.map((x) => x.platform))].sort();
    const defs = (await repo.definitions(db)).rows.find((d) => d.key === metric);
    return {
      kind: "gained_in_bucket" as const,   // change in the lifetime counter between buckets; NULL buckets have no earlier sample to compare with
      byPlatform: Object.fromEntries(platforms.map((p) => [p, pts(p)])),
      combined: defs?.comparable || platforms.length <= 1 ? pts() : null,
      combinedNote: defs?.comparable || platforms.length <= 1 ? null : "Not combined: this metric is defined differently on each platform.",
    };
  }
  async function followerGrowth(workspaceId: string, grain: Grain, r: Range, platform?: string, accountId?: string) {
    const rows = (await repo.aggregateRows(db, workspaceId, { scope: "account", metric: "followers", grain, from: bucketFloor(r.from, grain), to: r.to, platform, accountId })).rows;
    const [base, latest] = await Promise.all([repo.accountBaseline(db, workspaceId, "followers", r.from, platform), repo.accountLatest(db, workspaceId, "followers", r.to, platform, accountId)]);
    const series = (p?: string) => carryForwardSum(rows.filter((x) => !p || x.platform === p).map((x) => ({ account: x.social_account_id, bucket: x.bucket, value: num(x.last_value) })));
    const platforms = [...new Set(rows.map((x) => x.platform))].sort();
    const perAccount = latest.rows.filter((x) => !accountId || x.social_account_id === accountId).map((x) => {
      const b = base.rows.find((y) => y.social_account_id === x.social_account_id);
      return { accountId: x.social_account_id, platform: x.platform, latest: num(x.last_value), asOf: x.bucket, baseline: num(b?.last_value), growth: b && x.last_value != null ? Number(x.last_value) - Number(b.last_value) : null };
    });
    return { kind: "level" as const, byPlatform: Object.fromEntries(platforms.map((p) => [p, series(p)])), combined: series(), combinedNote: "Not de-duplicated: the same person can follow you on several platforms.", perAccount, growth: perAccount.every((x) => x.growth !== null) && perAccount.length ? perAccount.reduce((s, x) => s + x.growth!, 0) : null };
  }
  async function topPosts(workspaceId: string, metric: string, r: Range, platform: string | undefined, accountId: string | undefined, limit: number) {
    const def = (await repo.definitions(db)).rows.find((d) => d.key === metric);
    if (!def) throw badRequest(`Unknown metric '${metric}'`);
    if (!platform && !def.comparable) throw new AppError(400, "METRIC_NOT_COMPARABLE", `'${metric}' is defined differently on each platform, so posts from different platforms cannot be ranked together. Pass a platform.`);
    return (await repo.topPosts(db, workspaceId, { metric, ...r, platform, accountId, limit })).rows.map((x) => ({ jobId: x.job_id, postId: x.post_id, platform: x.platform, accountId: x.social_account_id, value: Number(x.value), title: x.title, preview: x.preview, url: x.url, publishedAt: x.published_at, format: x.media_kind ?? "text" }));
  }
}
export type AnalyticsService = ReturnType<typeof createAnalyticsService>;

const stripUndefined = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
