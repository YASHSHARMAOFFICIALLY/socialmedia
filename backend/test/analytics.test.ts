import { describe, it, expect, afterAll } from "vitest";
import type { MetricsResult } from "../src/integrations/core/types.js";
import { PlatformError } from "../src/integrations/core/errors.js";
import { rebuildAggregates } from "../src/modules/analytics/analytics.aggregator.js";
import { createFakeAdapter, metricsOf, ok } from "./helpers/fake-adapter.js";
import { createTestApp } from "./helpers/app.js";
import { jobs, seedAccount, world, type T, type U } from "./helpers/world.js";

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
const today = () => iso(0).slice(0, 10);

/** A published post destination (inserted directly: the publishing path has its own tests). */
async function publishedJob(t: T, ws: string, owner: U, accountId: string, platform: string, o: { publishedDaysAgo?: number; body?: string; externalId?: string } = {}) {
  const post = (await owner.agent.post(`/workspaces/${ws}/posts`).send({ body: o.body ?? "post", variants: [{ accountId }] })).body.data.id as string;
  const v = (await t.db.query<{ id: string }>("SELECT id FROM post_variants WHERE post_id = $1", [post])).rows[0]!.id;
  const at = iso(o.publishedDaysAgo ?? 1);
  const job = (await t.db.query<{ id: string }>(
    "INSERT INTO publishing_jobs (workspace_id, post_id, variant_id, social_account_id, platform, status, next_attempt_at, published_at, external_id, external_url, created_by, idempotency_key) VALUES ($1,$2,$3,$4,$5,'published',$6,$6,$7,$8,$9,$10) RETURNING id",
    [ws, post, v, accountId, platform, at, o.externalId ?? `ext-${Math.random()}`, `https://${platform}.example/p/1`, owner.id, `k${Math.random()}`])).rows[0]!.id;
  await t.db.query("UPDATE posts SET status = 'submitted' WHERE id = $1", [post]);
  return { post, job };
}
/** Collect everything the sweeper queued. */
async function runCollection(t: T) {
  const rep = await t.deps.engine.analytics.sweep();
  const out: string[] = [];
  while (t.analyticsQueued.length) out.push(await t.deps.engine.analytics.collect(t.analyticsQueued.shift()!));
  return { rep, out };
}
const analytics = (u: U, ws: string, path: string) => u.agent.get(`/workspaces/${ws}/analytics${path}`);
/** Backdated observation (the real pipeline stamps now(); history is append-only so tests insert with explicit time). */
async function observe(t: T, targetId: string, daysAgo: number, key: string, value: number | null, original = key) {
  const tg = (await t.db.query<{ workspace_id: string; social_account_id: string; platform: string; scope: string; job_id: string | null }>("SELECT workspace_id, social_account_id, platform, scope, job_id FROM analytics_targets WHERE id = $1", [targetId])).rows[0]!;
  const snap = (await t.db.query<{ id: string }>("INSERT INTO analytics_snapshots (workspace_id, target_id, social_account_id, platform, scope, job_id, source, collected_at, raw) VALUES ($1,$2,$3,$4,$5,$6,'test',$7,'{}') RETURNING id", [tg.workspace_id, targetId, tg.social_account_id, tg.platform, tg.scope, tg.job_id, iso(daysAgo)])).rows[0]!.id;
  await t.db.query("INSERT INTO analytics_metrics (snapshot_id, workspace_id, social_account_id, platform, scope, job_id, metric_key, original_name, value, availability, collected_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    [snap, tg.workspace_id, tg.social_account_id, tg.platform, tg.scope, tg.job_id, key, original, value, value === null ? "unavailable" : "available", iso(daysAgo)]);
  await rebuildAggregates(t.db, targetId);
  await t.db.query("INSERT INTO analytics_versions (workspace_id, version) VALUES ($1,1) ON CONFLICT (workspace_id) DO UPDATE SET version = analytics_versions.version + 1", [tg.workspace_id]);
}
const targetOf = async (t: T, jobId: string) => (await t.db.query<{ id: string }>("SELECT id FROM analytics_targets WHERE job_id = $1", [jobId])).rows[0]!.id;
const accountTarget = async (t: T, accountId: string) => (await t.db.query<{ id: string }>("SELECT id FROM analytics_targets WHERE social_account_id = $1 AND scope = 'account'", [accountId])).rows[0]!.id;

describe("analytics pipeline", async () => {
  const closers: (() => Promise<void>)[] = [];
  afterAll(async () => { for (const c of closers) await c(); });
  type Script = Parameters<typeof createFakeAdapter>;
  const mk = async (defs: { platform: "x" | "youtube" | "instagram" | "linkedin"; opts?: Script[2] }[]) => {
    const fakes = defs.map((d) => createFakeAdapter(d.platform, () => ok(), d.opts ?? {}));
    const t = await createTestApp(fakes.map((f) => f.adapter));
    closers.push(t.close);
    return { t, fakes };
  };
  const xPost = (n = 1) => ({ postMetrics: () => metricsOf({ "public_metrics.impression_count": 1000 * n, "public_metrics.like_count": 40 * n, "public_metrics.reply_count": 5, "public_metrics.retweet_count": 7, "public_metrics.quote_count": 2, "public_metrics.bookmark_count": 3 }), accountMetrics: () => metricsOf({ "public_metrics.followers_count": 500 }) });

  it("seeds targets only for platforms that support analytics, collects, normalizes, aggregates and serves the dashboard", async () => {
    const { t } = await mk([{ platform: "x", opts: xPost() }, { platform: "linkedin" }]);
    const { owner, ws, accounts } = await world(t, ["x", "linkedin"]);
    await publishedJob(t, ws, owner, accounts.x!, "x", { body: "x post" });
    await publishedJob(t, ws, owner, accounts.linkedin!, "linkedin", { body: "li post" });
    const { rep, out } = await runCollection(t);
    expect(rep.seeded).toBe(2);                                     // X account + X post. LinkedIn has no analytics: nothing is seeded for it
    expect(out.sort()).toEqual(["collected", "collected"]);
    const ov = (await analytics(owner, ws, "/overview")).body.data;
    const x = ov.platforms.find((p: { platform: string }) => p.platform === "x");
    expect(x.metrics.impressions).toMatchObject({ total: 1000, postsReporting: 1, postsUnavailable: 0 });
    expect(x.metrics.interactions.total).toBe(57);                  // 40 + 5 + 7 + 2 + 3
    expect(x.engagementRate).toMatchObject({ denominator: "impressions", postsIncluded: 1 });
    expect(x.engagementRate.rate).toBeCloseTo(0.057, 5);
    expect(x.followers).toMatchObject({ latest: 500, accountsReporting: 1 });
    const li = ov.platforms.find((p: { platform: string }) => p.platform === "linkedin");
    expect(li.supported).toMatchObject({ posts: false, accounts: false });
    expect(li.metrics).toEqual({});                                  // nothing fabricated for LinkedIn
    expect((await t.db.query("SELECT 1 FROM analytics_targets WHERE platform = 'linkedin'")).rowCount).toBe(0);
  });

  it("stores raw API responses and both original and canonical metric names", async () => {
    const { t } = await mk([{ platform: "x", opts: xPost() }]);
    const { owner, ws, accounts } = await world(t, ["x"]);
    const { job } = await publishedJob(t, ws, owner, accounts.x!, "x");
    await runCollection(t);
    const snap = (await t.db.query<{ raw: { public_metrics?: unknown }; source: string }>("SELECT raw, source FROM analytics_snapshots WHERE job_id = $1", [job])).rows[0]!;
    expect(snap.raw).toMatchObject({ "public_metrics.like_count": 40 });
    const row = (await t.db.query<{ metric_key: string; original_name: string; availability: string }>("SELECT metric_key, original_name, availability FROM analytics_metrics WHERE job_id = $1 AND metric_key = 'comments'", [job])).rows[0]!;
    expect(row).toMatchObject({ metric_key: "comments", original_name: "public_metrics.reply_count", availability: "available" });
  });

  it("history is append-only: normalized rows and raw snapshots cannot be modified", async () => {
    const { t } = await mk([{ platform: "x", opts: xPost() }]);
    const { owner, ws, accounts } = await world(t, ["x"]);
    await publishedJob(t, ws, owner, accounts.x!, "x");
    await runCollection(t);
    await expect(t.db.query("UPDATE analytics_metrics SET value = 0")).rejects.toThrow(/append-only/);
    await expect(t.db.query("UPDATE analytics_snapshots SET raw = '{}'")).rejects.toThrow(/append-only/);
    await t.db.query("UPDATE analytics_targets SET next_collect_at = now() - interval '1s', claim_token = NULL, enqueued_at = NULL WHERE scope = 'post'");
    await runCollection(t);
    expect((await t.db.query("SELECT 1 FROM analytics_snapshots WHERE scope = 'post'")).rowCount).toBe(2);   // a second snapshot was ADDED, nothing overwritten
  });

  it("UNAVAILABLE is not ZERO: missing metrics surface as null with coverage counts; real zeros stay zeros", async () => {
    const { t } = await mk([{ platform: "instagram", opts: { postMetrics: () => metricsOf({ views: 0, likes: 3, comments: null, saved: null, shares: 0, reach: 0 }), accountMetrics: () => metricsOf({ followers_count: 40 }) } }]);
    const { owner, ws, accounts } = await world(t, ["instagram"]);
    const { post } = await publishedJob(t, ws, owner, accounts.instagram!, "instagram");
    await runCollection(t);
    const ig = (await analytics(owner, ws, "/overview")).body.data.platforms[0];
    expect(ig.metrics.views.total).toBe(0);
    expect(ig.metrics.comments).toMatchObject({ total: null, postsReporting: 0, postsUnavailable: 1 });
    expect(ig.metrics.saves.total).toBeNull();
    expect(ig.metrics.interactions.total).toBe(3);                    // only the components that were actually reported
    const detail = (await analytics(owner, ws, `/posts/${post}`)).body.data.destinations[0];
    expect(detail.analytics.state).toBe("collected");
    const find = (k: string) => detail.metrics.find((m: { key: string }) => m.key === k);
    expect(find("comments")).toMatchObject({ value: null, availability: "unavailable", originalName: "comments" });
    expect(find("views")).toMatchObject({ value: 0, availability: "available" });
    expect(find("interactions").components.sort()).toEqual(["likes", "reposts"].filter(() => false).concat(["likes", "shares"]).sort());
    expect(detail.engagementRate).toBeNull();                          // reach = 0 and views = 0: no valid denominator, so no rate
  });

  it("post analytics reports unsupported / not_yet_collected / collected honestly", async () => {
    const { t } = await mk([{ platform: "x", opts: xPost() }, { platform: "linkedin" }]);
    const { owner, ws, accounts } = await world(t, ["x", "linkedin"]);
    const px = await publishedJob(t, ws, owner, accounts.x!, "x");
    const pl = await publishedJob(t, ws, owner, accounts.linkedin!, "linkedin");
    const state = async (post: string) => (await analytics(owner, ws, `/posts/${post}`)).body.data.destinations[0].analytics.state;
    expect(await state(px.post)).toBe("not_yet_collected");
    expect(await state(pl.post)).toBe("unsupported");
    await runCollection(t);
    expect(await state(px.post)).toBe("collected");
    expect((await analytics(owner, ws, `/posts/${(await owner.agent.post(`/workspaces/${ws}/posts`).send({ body: "d" })).body.data.id}`)).body.data.destinations).toEqual([]);   // draft: nothing published, nothing invented
  });

  it("NEVER sums metrics that platforms define differently; comparable ones are summed WITH per-platform values and a caveat", async () => {
    const { t } = await mk([{ platform: "x", opts: xPost() }, { platform: "youtube", opts: { postMetrics: () => metricsOf({ "statistics.viewCount": 5000, "statistics.likeCount": 100, "statistics.commentCount": 10 }), accountMetrics: () => metricsOf({ "statistics.subscriberCount": 2000 }) } }]);
    const { owner, ws, accounts } = await world(t, ["x", "youtube"]);
    await publishedJob(t, ws, owner, accounts.x!, "x");
    await publishedJob(t, ws, owner, accounts.youtube!, "youtube");
    await runCollection(t);
    const ov = (await analytics(owner, ws, "/overview")).body.data;
    const keys = ov.totals.map((x: { key: string }) => x.key).sort();
    expect(keys).toEqual(["comments", "followers", "interactions", "likes"]);          // views / impressions / reach are NOT here
    const likes = ov.totals.find((x: { key: string }) => x.key === "likes");
    expect(likes).toMatchObject({ total: 140, perPlatform: { x: 40, youtube: 100 } });
    expect(likes.caveat).toBeTruthy();
    expect(ov.totals.find((x: { key: string }) => x.key === "interactions").total).toBe(57 + 110);
    expect(ov.totals.find((x: { key: string }) => x.key === "followers").caveat).toMatch(/de-duplicated/);
    expect(ov.notSummed.map((x: { key: string }) => x.key)).toEqual(expect.arrayContaining(["views", "impressions"]));
    const cmp = (await analytics(owner, ws, "/compare/platforms")).body.data;
    const views = cmp.metrics.find((m: { key: string }) => m.key === "views");
    expect(views.comparable).toBe(false);
    expect(Object.keys(views.values)).toEqual(["youtube"]);                            // X does not report views; absent, not zero
    expect(cmp.metrics.find((m: { key: string }) => m.key === "impressions").values.x.total).toBe(1000);
  });

  it("top posts: ranks within a platform for any metric; across platforms only for comparable metrics", async () => {
    const { t } = await mk([{ platform: "x", opts: xPost() }, { platform: "youtube", opts: { postMetrics: () => metricsOf({ "statistics.viewCount": 5000, "statistics.likeCount": 100, "statistics.commentCount": 10 }) } }]);
    const { owner, ws, accounts } = await world(t, ["x", "youtube"]);
    const a = await publishedJob(t, ws, owner, accounts.x!, "x", { body: "A" });
    const b = await publishedJob(t, ws, owner, accounts.x!, "x", { body: "B" });
    const c = await publishedJob(t, ws, owner, accounts.youtube!, "youtube", { body: "C" });
    await runCollection(t);
    await observe(t, await targetOf(t, b.job), 0, "likes", 500);
    const top = (await analytics(owner, ws, "/top-posts?metric=likes&limit=3")).body.data.posts;
    expect(top.map((p: { preview: string; value: number }) => [p.preview, p.value])).toEqual([["B", 500], ["C", 100], ["A", 40]]);
    expect(top[0].format).toBe("text");
    const rej = await analytics(owner, ws, "/top-posts?metric=views");
    expect(rej.status).toBe(400);
    expect(rej.body.error.code).toBe("METRIC_NOT_COMPARABLE");
    expect((await analytics(owner, ws, "/top-posts?metric=views&platform=youtube")).body.data.posts.map((p: { preview: string }) => p.preview)).toEqual(["C"]);
    expect((await analytics(owner, ws, "/top-posts?metric=nope")).status).toBe(400);
    void a;
  });

  it("daily/weekly/monthly trends: bucket changes, first bucket of a post counts its whole value (counters start at 0 at publish), partial buckets flagged", async () => {
    const { t } = await mk([{ platform: "x", opts: xPost() }]);
    const { owner, ws, accounts } = await world(t, ["x"]);
    const p = await publishedJob(t, ws, owner, accounts.x!, "x", { publishedDaysAgo: 10 });
    await runCollection(t);                                           // seeds targets (and records "now" observations)
    const target = await targetOf(t, p.job);
    for (const [d, v] of [[6, 10], [5, 25], [3, 60], [0, 100]] as const) await observe(t, target, d, "likes", v);
    const day = (await analytics(owner, ws, `/trends?metric=likes&grain=day&from=${iso(7).slice(0, 10)}&to=${today()}`)).body.data;
    const pts = day.byPlatform.x as { bucket: string; value: number | null }[];
    const byBucket = Object.fromEntries(pts.map((x) => [x.bucket, x.value]));
    expect(byBucket[iso(5).slice(0, 10)]).toBe(15);                    // 25 - 10
    expect(byBucket[iso(3).slice(0, 10)]).toBe(35);                    // 60 - 25 (gap days carry no sample, so the change spans them)
    expect(day.kind).toBe("gained_in_bucket");
    expect(pts[0]!.value).toBe(10);                                    // earliest bucket: the counter started at 0 when the post was published, so the first sample IS the gain
    const week = (await analytics(owner, ws, `/trends?metric=likes&grain=week&from=${iso(14).slice(0, 10)}&to=${today()}`)).body.data;
    expect(week.byPlatform.x.length).toBeGreaterThanOrEqual(1);
    const month = (await analytics(owner, ws, `/trends?metric=likes&grain=month&from=${iso(40).slice(0, 10)}&to=${today()}`)).body.data;
    expect(month.grain).toBe("month");
    expect((await analytics(owner, ws, "/trends?metric=bogus")).status).toBe(400);
  });

  it("Instagram-style account insights: day-period metrics become a daily activity series (unavailable stays null), audience demographics are served and refreshed weekly", async () => {
    let audienceCalls = 0;
    const day = (reach: number | null): MetricsResult => ({ source: "fake://acct", raw: {}, metrics: [
      { originalName: "followers_count", value: 500, availability: "available" },
      { originalName: "reach", value: reach, availability: reach === null ? "unavailable" : "available", period: "day" },
      { originalName: "accounts_engaged", value: 12, availability: "available", period: "day" }] });
    const { t } = await mk([{ platform: "instagram", opts: { accountMetrics: () => day(300), audience: () => { audienceCalls++; return { rows: [{ kind: "follower", breakdown: "gender", timeframe: "this_month", values: { "F": 60, "M": 40 } }], unavailable: { engaged_audience_demographics_age: 400 } }; } } }]);
    const { owner, ws, accounts } = await world(t, ["instagram"]);
    await runCollection(t);
    const acc = accounts.instagram!;
    const act = (await analytics(owner, ws, `/activity?from=${iso(1).slice(0, 10)}&to=${today()}&accountId=${acc}`)).body.data;
    const reach = act.series.find((s: { metric: string }) => s.metric === "reach");
    expect(reach.points).toEqual([{ day: today(), value: 300 }]);
    expect(act.series.find((s: { metric: string }) => s.metric === "accounts_engaged").points[0].value).toBe(12);
    expect((await t.db.query("SELECT 1 FROM analytics_metrics WHERE scope = 'account' AND period = 'day' AND metric_key = 'reach'")).rowCount).toBe(1);
    const aud = (await analytics(owner, ws, `/accounts/${acc}/audience`)).body.data;
    expect(aud.follower.gender).toEqual({ F: 60, M: 40 });
    expect(aud.engaged).toEqual({});
    expect(audienceCalls).toBe(1);
    await t.db.query("UPDATE analytics_targets SET next_collect_at = now() - interval '1 minute', enqueued_at = NULL, claim_token = NULL WHERE scope = 'account'");
    await runCollection(t);
    expect((await t.db.query("SELECT 1 FROM analytics_snapshots WHERE scope = 'account'")).rowCount).toBe(2);   // it really collected again
    expect(audienceCalls).toBe(1);                                  // fresh for a week: not requested again
    await t.db.query("UPDATE analytics_audience SET collected_at = now() - interval '8 days'"); await t.db.query("UPDATE analytics_targets SET next_collect_at = now() - interval '1 minute', enqueued_at = NULL, claim_token = NULL WHERE scope = 'account'");
    await runCollection(t);
    expect(audienceCalls).toBe(2);
    const outsider = await t.newUser("out");
    expect((await analytics(outsider, ws, `/accounts/${acc}/audience`)).status).toBe(404);
  });

  it("follower growth: level series per platform, carried forward, with baseline growth and an honest 'not de-duplicated' note", async () => {
    const { t } = await mk([{ platform: "x", opts: xPost() }, { platform: "youtube", opts: { accountMetrics: () => metricsOf({ "statistics.subscriberCount": 2000 }), postMetrics: () => metricsOf({}) } }]);
    const { owner, ws, accounts } = await world(t, ["x", "youtube"]);
    await runCollection(t);
    const tx = await accountTarget(t, accounts.x!), ty = await accountTarget(t, accounts.youtube!);
    await observe(t, tx, 20, "followers", 400); await observe(t, tx, 2, "followers", 450);
    await observe(t, ty, 20, "followers", 1900);
    const f = (await analytics(owner, ws, `/trends?metric=followers&grain=day&from=${iso(10).slice(0, 10)}&to=${today()}`)).body.data;
    expect(f.kind).toBe("level");
    const x = f.perAccount.find((a: { platform: string }) => a.platform === "x");
    expect(x.baseline).toBe(400);
    expect(x.latest).toBe(500);                                        // today's collection
    expect(x.growth).toBe(100);
    expect(f.combinedNote).toMatch(/de-duplicated/);
    expect(f.combined.at(-1).value).toBe(2500);                        // 500 (X) + 2000 (YouTube), carried forward across days
    const noBaseline = (await analytics(owner, ws, `/trends?metric=followers&from=${iso(30).slice(0, 10)}&to=${iso(25).slice(0, 10)}`)).body.data;
    expect(noBaseline.growth).toBeNull();                              // unknown, not 0
  });

  it("date-range filtering and range comparison; change is null (not 0) when a side has no data", async () => {
    const { t } = await mk([{ platform: "x", opts: { postMetrics: (_n: number, id: string) => metricsOf({ "public_metrics.like_count": id === "old" ? 7 : 40 }) } }]);
    const { owner, ws, accounts } = await world(t, ["x"]);
    await publishedJob(t, ws, owner, accounts.x!, "x", { publishedDaysAgo: 2, body: "recent", externalId: "recent" });
    const old = await publishedJob(t, ws, owner, accounts.x!, "x", { publishedDaysAgo: 40, body: "old", externalId: "old" });
    await runCollection(t);
    void old;
    const inRange = (await analytics(owner, ws, `/top-posts?metric=likes&platform=x&from=${iso(5).slice(0, 10)}&to=${today()}`)).body.data.posts;
    expect(inRange.map((p: { preview: string }) => p.preview)).toEqual(["recent"]);
    expect((await analytics(owner, ws, `/top-posts?metric=likes&platform=x&from=${iso(60).slice(0, 10)}&to=${iso(30).slice(0, 10)}`)).body.data.posts.map((p: { preview: string }) => p.preview)).toEqual(["old"]);
    const cmp = (await analytics(owner, ws, `/compare/ranges?aFrom=${iso(60).slice(0, 10)}&aTo=${iso(30).slice(0, 10)}&bFrom=${iso(5).slice(0, 10)}&bTo=${today()}`)).body.data;
    const likes = cmp.platforms[0].metrics.likes;
    expect(likes.a).toBe(7);
    expect(likes.b).toBe(40);
    expect(likes.change).toBe(33);
    const empty = (await analytics(owner, ws, `/compare/ranges?aFrom=${iso(400).slice(0, 10)}&aTo=${iso(380).slice(0, 10)}&bFrom=${iso(5).slice(0, 10)}&bTo=${today()}`)).body.data;
    expect(empty.platforms[0].metrics.likes).toMatchObject({ a: null, change: null });
    expect((await analytics(owner, ws, `/overview?from=2030-02-01&to=2030-01-01`)).status).toBe(400);
    expect((await analytics(owner, ws, `/overview?from=2020-01-01&to=2030-01-01`)).status).toBe(400);
    expect((await analytics(owner, ws, `/overview?from=not-a-date`)).status).toBe(400);
  });

  it("collection failures stay inside analytics: rate limits reschedule, permanent errors disable the target, publishing state is untouched", async () => {
    let mode: "rate" | "perm" | "ok" = "rate";
    const { t } = await mk([{ platform: "x", opts: { postMetrics: () => { if (mode === "rate") throw new PlatformError("rate_limited", "429", { retryAfterS: 3600 }); if (mode === "perm") throw new PlatformError("permanent", "post deleted"); return metricsOf({ "public_metrics.like_count": 1 }); } } }]);
    const { owner, ws, accounts } = await world(t, ["x"]);
    const p = await publishedJob(t, ws, owner, accounts.x!, "x");
    const before = await jobs(t, ws);
    expect((await runCollection(t)).out).toEqual(["failed"]);
    const tg = (await t.db.query<{ failures: number; s: number; status: string }>("SELECT failures, EXTRACT(EPOCH FROM next_collect_at - now())::float8 AS s, status FROM analytics_targets WHERE job_id = $1", [p.job])).rows[0]!;
    expect(tg).toMatchObject({ failures: 1, status: "active" });
    expect(tg.s).toBeGreaterThan(3000);                                // waits out the rate limit
    mode = "perm";
    for (let i = 0; i < 5; i++) {
      await t.db.query("UPDATE analytics_targets SET next_collect_at = now() - interval '1s', claim_token = NULL, enqueued_at = NULL WHERE job_id = $1", [p.job]);
      await runCollection(t);
    }
    expect((await t.db.query<{ status: string; last_error: string }>("SELECT status, last_error FROM analytics_targets WHERE job_id = $1", [p.job])).rows[0]).toMatchObject({ status: "disabled", last_error: "post deleted" });
    expect(await jobs(t, ws)).toEqual(before);                         // publishing rows are byte-for-byte unchanged
    expect((await analytics(owner, ws, `/posts/${p.post}`)).status).toBe(200);   // reads still work
  });

  it("duplicate/concurrent collection of one target yields a single snapshot", async () => {
    let calls = 0;
    const { t } = await mk([{ platform: "x", opts: { postMetrics: async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return metricsOf({ "public_metrics.like_count": 1 }); } } }]);
    const { owner, ws, accounts } = await world(t, ["x"]);
    const p = await publishedJob(t, ws, owner, accounts.x!, "x");
    await t.deps.engine.analytics.sweep();
    const id = await targetOf(t, p.job);
    const res = await Promise.all(Array.from({ length: 4 }, () => t.deps.engine.analytics.collect(id)));
    expect(res.filter((r) => r === "collected")).toHaveLength(1);
    expect(calls).toBe(1);
  });

  it("a disconnected/needs_reauth account is not polled; due targets lost from the queue are re-queued", async () => {
    const { t } = await mk([{ platform: "x", opts: xPost() }]);
    const { owner, ws, accounts } = await world(t, ["x"]);
    await publishedJob(t, ws, owner, accounts.x!, "x");
    await t.deps.engine.analytics.sweep();
    expect(t.analyticsQueued.length).toBe(2);
    t.analyticsQueued.length = 0;
    expect((await t.deps.engine.analytics.sweep()).queued).toBe(0);    // queued recently: not re-queued yet
    await t.db.query("UPDATE analytics_targets SET enqueued_at = now() - interval '11 minutes'");
    expect((await t.deps.engine.analytics.sweep()).queued).toBe(2);    // message presumed lost: queued again
    await t.db.query("UPDATE social_accounts SET status = 'needs_reauth'");
    t.analyticsQueued.length = 0;
    await t.db.query("UPDATE analytics_targets SET enqueued_at = NULL");
    expect((await t.deps.engine.analytics.sweep()).queued).toBe(0);
  });

  it("dashboard responses are cached per data version and invalidated by new data", async () => {
    const { t } = await mk([{ platform: "x", opts: xPost() }]);
    const { owner, ws, accounts } = await world(t, ["x"]);
    const p = await publishedJob(t, ws, owner, accounts.x!, "x");
    await runCollection(t);
    const first = (await analytics(owner, ws, "/overview")).body.data;
    expect(first.cached).toBeUndefined();
    expect((await analytics(owner, ws, "/overview")).body.data.cached).toBe(true);
    await observe(t, await targetOf(t, p.job), 0, "likes", 999);       // new data bumps the workspace version
    const third = (await analytics(owner, ws, "/overview")).body.data;
    expect(third.cached).toBeUndefined();
    expect(third.platforms[0].metrics.likes.total).toBe(999);
  });

  it("sync-status reports freshness and failing targets per platform, with no raw error text", async () => {
    const { t } = await mk([{ platform: "x", opts: xPost() }]);
    const { owner, ws, accounts } = await world(t, ["x"]);
    await publishedJob(t, ws, owner, accounts.x!, "x");
    expect((await analytics(owner, ws, "/sync-status")).body.data.platforms).toEqual([]);          // nothing seeded yet
    await runCollection(t);
    const x = (await analytics(owner, ws, "/sync-status")).body.data.platforms[0];
    expect(x.platform).toBe("x");
    expect(x.scopes.find((s: { scope: string }) => s.scope === "post")).toMatchObject({ targets: 1, failing: 0 });
    expect(x.scopes[0].lastCollectedAt).not.toBeNull();
    await t.db.query("UPDATE analytics_targets SET failures = 2, last_error = 'secret-token-abc' WHERE scope = 'post'");
    const res = await analytics(owner, ws, "/sync-status");
    expect(res.body.data.platforms[0].scopes.find((s: { scope: string }) => s.scope === "post").failing).toBe(1);
    expect(JSON.stringify(res.body)).not.toContain("secret-token-abc");
  });

  it("authorization and tenant isolation on every analytics route", async () => {
    const { t } = await mk([{ platform: "x", opts: xPost() }]);
    const { owner, ws, accounts } = await world(t, ["x"]);
    const p = await publishedJob(t, ws, owner, accounts.x!, "x");
    await runCollection(t);
    const paths = ["/overview", "/sync-status", "/metrics", "/platforms/x", `/accounts/${accounts.x}`, `/posts/${p.post}`, "/trends?metric=likes", "/compare/platforms", "/top-posts"];
    const stranger = await t.newUser("s");
    for (const path of paths) expect((await analytics(stranger, ws, path)).status, path).toBe(404);
    const viewer = await t.newUser("v");
    await t.db.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'viewer')", [ws, viewer.id]);
    for (const path of paths) expect((await analytics(viewer, ws, path)).status, path).toBe(403);       // viewers do not have analytics:read
    const analyst = await t.newUser("a");
    await t.db.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'analyst')", [ws, analyst.id]);
    for (const path of paths) expect((await analytics(analyst, ws, path)).status, path).toBe(200);
    const other = await world(t, ["x"]);
    expect((await analytics(other.owner, other.ws, `/posts/${p.post}`)).status).toBe(404);              // another tenant's post id
    expect((await analytics(other.owner, other.ws, `/accounts/${accounts.x}`)).status).toBe(404);
    const otherOv = (await analytics(other.owner, other.ws, "/overview")).body.data;
    expect(JSON.stringify(otherOv.platforms.map((x: { metrics: object }) => x.metrics))).toBe(JSON.stringify([{}]));   // no leakage
  });
});
