import { describe, it, expect, afterAll } from "vitest";
import { bestPlatform, bestPostingTime, engagementChange, followerTrend, formatPerformance, median, postingConsistency, recommend, rulesProvider, type Dataset, type PostPerf } from "../src/modules/insights/insights.rules.js";
import { createFakeAdapter, metricsOf, ok } from "./helpers/fake-adapter.js";
import { createTestApp } from "./helpers/app.js";
import { world, type T, type U } from "./helpers/world.js";

const range = { from: "2030-06-01", to: "2030-06-28" };
const post = (platform: string, interactions: number | null, o: Partial<PostPerf> = {}): PostPerf => ({ jobId: `j${Math.random()}`, platform, publishedAt: "2030-06-10T10:00:00Z", format: "text", interactions, views: null, impressions: null, reach: null, ...o });
const ds = (o: Partial<Dataset> = {}): Dataset => ({ range, timezone: "UTC", posts: [], published: [], interactionGain: [], gainWindows: { recent: { from: "2030-06-22", to: "2030-06-28" }, previous: { from: "2030-06-15", to: "2030-06-21" } }, followers: [], ...o });
const many = (n: number, platform: string, v: (i: number) => number | null, o: Partial<PostPerf> | ((i: number) => Partial<PostPerf>) = {}) => Array.from({ length: n }, (_, i) => post(platform, v(i), typeof o === "function" ? o(i) : o));

describe("insight rules", () => {
  it("median is robust to one viral post", () => { expect(median([1, 2, 3, 1000])).toBe(2.5); expect(median([])).toBeNull(); });

  it("best platform: states the comparison with numbers and the date range; refuses with too little data", () => {
    const d = ds({ posts: [...many(6, "linkedin", () => 40), ...many(6, "x", () => 10)] });
    const r = bestPlatform(d).insight!;
    expect(r.message).toBe("Your linkedin posts received higher engagement than your x posts between 2030-06-01 and 2030-06-28 (median 40 vs 10 interactions per post).");
    expect(r.evidence).toMatchObject({ range, ratio: 4 });
    const few = bestPlatform(ds({ posts: [...many(2, "linkedin", () => 40), ...many(6, "x", () => 10)] }));
    expect(few.insight).toBeUndefined();
    expect(few.skip!.reason).toMatch(/at least 5 posts/);
    expect(bestPlatform(ds({ posts: [...many(6, "linkedin", () => 11), ...many(6, "x", () => 10)] })).insight!.title).toMatch(/No clear difference/);
    expect(bestPlatform(ds({ posts: [...many(6, "a", () => null), ...many(6, "b", () => null)] })).skip).toBeDefined();   // posts without data are not counted as zeros
  });

  it("format performance compares formats only within one platform and only when both have enough posts", () => {
    const posts = [...many(6, "linkedin", () => 60, { format: "video" }), ...many(6, "linkedin", () => 20, { format: "image" }), ...many(6, "x", () => 5, { format: "video" }), ...many(2, "x", () => 50, { format: "image" })];
    const r = formatPerformance(ds({ posts }));
    expect(r.insights).toHaveLength(1);
    expect(r.insights[0]!.message).toBe("Your linkedin video posts generated 3x the interactions of image posts (median 60 vs 20).");
    expect(r.skips.some((s) => s.reason.startsWith("x:"))).toBe(true);
    expect(formatPerformance(ds({ posts: [...many(6, "linkedin", () => 21, { format: "video" }), ...many(6, "linkedin", () => 20, { format: "image" })] })).insights).toHaveLength(0);
  });

  it("engagement change: percentage vs the previous window; silent without both windows", () => {
    const up = engagementChange(ds({ interactionGain: [{ platform: "x", a: 150, b: 100 }, { platform: "youtube", a: 60, b: 50 }] })).insight!;
    expect(up.message).toBe("Your engagement increased compared with the previous seven days (210 vs 150 interactions gained, +40%).");
    expect(up.severity).toBe("positive");
    expect(engagementChange(ds({ interactionGain: [{ platform: "x", a: 95, b: 100 }] })).insight!.title).toBe("Engagement stayed about the same");
    expect(engagementChange(ds({ interactionGain: [{ platform: "x", a: 50, b: 100 }] })).insight!.severity).toBe("warning");
    expect(engagementChange(ds({ interactionGain: [{ platform: "x", a: 50, b: null }] })).skip).toBeDefined();           // unknown is not zero
    expect(engagementChange(ds({ interactionGain: [{ platform: "x", a: 50, b: 0 }] })).skip!.reason).toMatch(/not meaningful/);
  });

  it("consistency flags irregular posting from published dates", () => {
    const wk = (n: number) => ({ platform: "x", publishedAt: `2030-06-${String(1 + n * 7).padStart(2, "0")}T10:00:00Z` });
    const sparse = postingConsistency(ds({ published: [wk(0)] })).insight!;
    expect(sparse).toMatchObject({ severity: "warning", evidence: { weeksWithPosts: 1, weeks: 4, posts: 1 } });
    expect(postingConsistency(ds({ published: [wk(0), wk(1), wk(2), wk(3)] })).insight!.severity).toBe("info");
    expect(postingConsistency(ds()).skip).toBeDefined();
  });

  it("follower trend needs a baseline", () => {
    const r = followerTrend(ds({ followers: [{ platform: "x", latest: 520, change: 20 }, { platform: "youtube", latest: 10, change: null }] }));
    expect(r.insights[0]!.message).toBe("Your x audience grew by 20 to 520 between 2030-06-01 and 2030-06-28.");
    expect(r.skips[0]!.reason).toMatch(/no follower count/);
  });

  it("best posting time stays silent below 20 posts, and below a clear winner", () => {
    expect(bestPostingTime(ds({ posts: many(10, "x", () => 5) })).insights).toHaveLength(0);
    // 24 posts: 6 on Monday morning with 50, 18 elsewhere with 10
    const mon = (h: number) => `2030-06-10T${String(h).padStart(2, "0")}:00:00Z`;       // 2030-06-10 is a Monday
    const posts = [...many(6, "x", () => 50, { publishedAt: mon(9) }), ...many(18, "x", () => 10, (i) => ({ publishedAt: `2030-06-${11 + (i % 5)}T${i % 2 ? "20" : "03"}:00:00Z` }))];
    const r = bestPostingTime(ds({ posts }));
    expect(r.insights[0]!.title).toBe("Best posting slot on X: Monday morning (06-12)");
    expect(r.insights[0]!.evidence).toMatchObject({ slotPosts: 6, slotMedian: 50, overallMedian: 10 });
    expect(bestPostingTime(ds({ posts: many(24, "x", () => 10, (i) => ({ publishedAt: mon(i % 24) })) })).insights).toHaveLength(0);
  });

  it("recommendations come only from insights that cleared their thresholds, and carry caveats", () => {
    const d = ds({ posts: [...many(6, "linkedin", () => 90, { format: "video" }), ...many(6, "linkedin", () => 20, { format: "image" }), ...many(6, "x", () => 5)], published: [{ platform: "x", publishedAt: "2030-06-02T10:00:00Z" }] });
    const recs = recommend(rulesProvider(d) instanceof Promise ? [] : (rulesProvider(d) as { insights: never[] }).insights);
    expect(recs.map((r) => r.basedOn).sort()).toEqual(["best_platform", "format_performance", "posting_consistency"]);
    expect(recs.every((r) => r.caveat.length > 10 && r.because.length > 10)).toBe(true);
    expect(recommend([])).toEqual([]);
  });
});

describe("insights API", async () => {
  const x = createFakeAdapter("x", () => ok(), { postMetrics: (_n: number, id: string) => metricsOf({ "public_metrics.like_count": Number(id.split("-")[1]), "public_metrics.impression_count": 1000 }) });
  const yt = createFakeAdapter("youtube", () => ok(), { postMetrics: () => metricsOf({ "statistics.likeCount": 5, "statistics.viewCount": 500 }) });
  const t: T = await createTestApp([x.adapter, yt.adapter]);
  afterAll(t.close);
  const iso = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
  async function published(ws: string, owner: U, accountId: string, platform: string, externalId: string, daysAgo: number) {
    const post = (await owner.agent.post(`/workspaces/${ws}/posts`).send({ body: externalId, variants: [{ accountId }] })).body.data.id as string;
    const v = (await t.db.query<{ id: string }>("SELECT id FROM post_variants WHERE post_id = $1", [post])).rows[0]!.id;
    await t.db.query("INSERT INTO publishing_jobs (workspace_id, post_id, variant_id, social_account_id, platform, status, next_attempt_at, published_at, external_id, created_by, idempotency_key) VALUES ($1,$2,$3,$4,$5,'published',$6,$6,$7,$8,$9)", [ws, post, v, accountId, platform, iso(daysAgo), externalId, owner.id, `k${Math.random()}`]);
  }

  it("with real collected data: states what it found, with evidence; otherwise explains what is missing", async () => {
    const w = await world(t, ["x", "youtube"]);
    for (let i = 0; i < 6; i++) { await published(w.ws, w.owner, w.accounts.x!, "x", `x-${100 + i}`, i + 1); await published(w.ws, w.owner, w.accounts.youtube!, "youtube", `yt-${i}`, i + 1); }
    await t.deps.engine.analytics.sweep();
    while (t.analyticsQueued.length) await t.deps.engine.analytics.collect(t.analyticsQueued.shift()!);
    const r = (await w.owner.agent.get(`/workspaces/${w.ws}/insights`)).body.data;
    expect(r.postsAnalyzed).toBe(12);
    const best = r.insights.find((i: { type: string }) => i.type === "best_platform");
    expect(best.message).toMatch(/x posts received higher engagement than your youtube posts/);
    expect(best.evidence.platforms.map((p: { platform: string; posts: number }) => [p.platform, p.posts])).toEqual([["x", 6], ["youtube", 6]]);
    expect(r.skipped.some((s: { type: string }) => s.type === "best_posting_time")).toBe(true);          // 6 posts per platform: far too few to talk about timing
    expect(r.recommendations.some((x: { basedOn: string }) => x.basedOn === "best_platform")).toBe(true);
    const rec = (await w.owner.agent.get(`/workspaces/${w.ws}/insights/recommendations`)).body.data;
    expect(rec.recommendations.length).toBeGreaterThan(0);
    // a workspace with no data gets explanations, not made-up advice
    const empty = await world(t, ["x"]);
    const e = (await empty.owner.agent.get(`/workspaces/${empty.ws}/insights`)).body.data;
    expect(e.insights).toEqual([]);
    expect(e.skipped.length).toBeGreaterThan(0);
    expect((await empty.owner.agent.get(`/workspaces/${empty.ws}/insights/recommendations`)).body.data.recommendations).toEqual([]);
  });

  it("validates input and enforces analytics permission and tenancy", async () => {
    const w = await world(t, ["x"]);
    expect((await w.owner.agent.get(`/workspaces/${w.ws}/insights?timezone=Mars/Base`)).status).toBe(400);
    expect((await w.owner.agent.get(`/workspaces/${w.ws}/insights?from=2030-02-01&to=2030-01-01`)).status).toBe(400);
    const stranger = await t.newUser("s");
    expect((await stranger.agent.get(`/workspaces/${w.ws}/insights`)).status).toBe(404);
    const viewer = await t.newUser("v");
    await t.db.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'viewer')", [w.ws, viewer.id]);
    expect((await viewer.agent.get(`/workspaces/${w.ws}/insights`)).status).toBe(403);
  });
});
