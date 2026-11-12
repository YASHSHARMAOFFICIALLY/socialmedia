import { describe, it, expect, afterAll } from "vitest";
import { createXAdapter } from "../src/integrations/x/x.adapter.js";
import { createYouTubeAdapter } from "../src/integrations/youtube/youtube.adapter.js";
import { parseChannelRef } from "../src/integrations/youtube/youtube.competitors.js";
import { PlatformError } from "../src/integrations/core/errors.js";
import { publicInteractions } from "../src/modules/competitors/competitor.service.js";
import { createFakeAdapter, metricsOf, ok } from "./helpers/fake-adapter.js";
import { createTestApp } from "./helpers/app.js";
import { world, type T, type U } from "./helpers/world.js";

const day = (n: number) => new Date(Date.now() - n * 86_400_000);

describe("competitor adapters (mocked official APIs)", () => {
  it("X: resolves a username with public metrics and reads the public timeline", async () => {
    const urls: string[] = [];
    const f = (async (u: string) => { urls.push(String(u)); return String(u).includes("/by/username/")
      ? Response.json({ data: { id: "42", name: "Rival", username: "rival", public_metrics: { followers_count: 1000, post_count: 50 } } })
      : Response.json({ data: [{ id: "t1", created_at: day(1).toISOString(), public_metrics: { like_count: 5, reply_count: 1, retweet_count: 2, quote_count: 0, impression_count: 300 } }] }); }) as unknown as typeof fetch;
    const a = createXAdapter({ clientId: "c", clientSecret: "s" }, f);
    expect(a.capabilities.competitorLookup).toBe(true);
    const p = await a.lookupPublicProfile!({ accessToken: "T", handle: "@rival" });
    expect(p).toMatchObject({ externalId: "42", handle: "rival", followers: 1000, posts: 50 });
    expect(urls[0]).toContain("/users/by/username/rival?user.fields=public_metrics");
    const posts = await a.fetchPublicPosts!({ accessToken: "T", profile: p, limit: 20 });
    expect(posts[0]).toMatchObject({ externalId: "t1", metrics: { likes: 5, comments: 1, reposts: 2, quotes: 0, impressions: 300 }, url: "https://x.com/rival/status/t1" });
    expect(urls[1]).toContain("exclude=retweets,replies");
    expect(await a.lookupPublicProfile!({ accessToken: "T", handle: "bad handle!" }).catch((e) => e)).toBeInstanceOf(PlatformError);
    expect(await createXAdapter({ clientId: "c", clientSecret: "s" }, (async () => Response.json({})) as unknown as typeof fetch).lookupPublicProfile!({ accessToken: "T", handle: "ghost" }).catch((e) => e)).toMatchObject({ kind: "permanent" });
  });

  it("YouTube: parses channel references, treats hidden subscriber counts as unavailable (not 0), reads uploads + statistics", async () => {
    expect(parseChannelRef("https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv")).toEqual({ id: "UCabcdefghijklmnopqrstuv" });
    expect(parseChannelRef("https://www.youtube.com/@SomeCreator")).toEqual({ handle: "SomeCreator" });
    expect(parseChannelRef("@SomeCreator")).toEqual({ handle: "SomeCreator" });
    expect(parseChannelRef("???")).toBeNull();
    const urls: string[] = [];
    const f = (async (u: string) => { urls.push(String(u)); const s = String(u);
      if (s.includes("/channels?")) return Response.json({ items: [{ id: "UC1", snippet: { title: "Chan", customUrl: "@chan" }, statistics: { hiddenSubscriberCount: true, subscriberCount: "0", videoCount: "10", viewCount: "999" }, contentDetails: { relatedPlaylists: { uploads: "UU1" } } }] });
      if (s.includes("/playlistItems")) return Response.json({ items: [{ contentDetails: { videoId: "v1" } }] });
      return Response.json({ items: [{ id: "v1", snippet: { publishedAt: day(2).toISOString() }, statistics: { viewCount: "100", likeCount: "7" } }] }); }) as unknown as typeof fetch;
    const a = createYouTubeAdapter({ clientId: "c", clientSecret: "s" }, f);
    const p = await a.lookupPublicProfile!({ accessToken: "T", handle: "https://www.youtube.com/@chan" });
    expect(urls[0]).toContain("forHandle=%40chan");
    expect(p).toMatchObject({ externalId: "UC1", followers: null, posts: 10, uploadsPlaylistId: "UU1" });      // hidden => null, never the misleading "0"
    const posts = await a.fetchPublicPosts!({ accessToken: "T", profile: p, limit: 20 });
    expect(posts[0]).toMatchObject({ externalId: "v1", metrics: { views: 100, likes: 7, comments: null } });
  });

  it("public interaction totals use only what is provided", () => {
    expect(publicInteractions({ likes: 5, comments: 1, reposts: 2, quotes: 0, impressions: 300 })).toBe(8);
    expect(publicInteractions({ views: 100 })).toBeNull();
    expect(publicInteractions({ likes: null })).toBeNull();
  });
});

describe("competitor intelligence", async () => {
  let profileFor: (h: string) => any = (h) => ({ externalId: `ext-${h}`, handle: h, displayName: `Rival ${h}`, followers: 1000, posts: 40 });
  let postsFor: (p: { externalId: string }) => any[] = () => [];
  let failProfile: PlatformError | null = null;
  const x = createFakeAdapter("x", () => ok(), {
    competitor: { profile: (h) => { if (failProfile) throw failProfile; return profileFor(h); }, posts: (p) => postsFor(p) },
    postMetrics: (_n: number, id: string) => metricsOf({ "public_metrics.like_count": 20, "public_metrics.reply_count": 2, "public_metrics.retweet_count": 3, "public_metrics.quote_count": 1, "public_metrics.bookmark_count": 999 }),
  });
  const li = createFakeAdapter("linkedin", () => ok());
  const t: T = await createTestApp([x.adapter, li.adapter]);
  afterAll(t.close);
  const add = (u: U, ws: string, body: object) => u.agent.post(`/workspaces/${ws}/competitors`).send(body);
  const forceDue = (id?: string) => t.db.query("UPDATE competitors SET next_collect_at = now() - interval '1s', claim_until = NULL WHERE $1::uuid IS NULL OR id = $1", [id ?? null]);

  it("tracks a competitor through your own connection and stores snapshots + recent posts", async () => {
    postsFor = () => [{ externalId: "p1", publishedAt: day(1), url: "u1", metrics: { likes: 10, comments: 2, reposts: 3, quotes: 0, impressions: 500 } }, { externalId: "p2", publishedAt: day(3), url: "u2", metrics: { likes: 40, comments: 5, reposts: 5, quotes: 1, impressions: null } }];
    const w = await world(t, ["x"]);
    const r = await add(w.owner, w.ws, { platform: "x", handle: "rivalone" });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ platform: "x", handle: "rivalone", status: "active", displayName: "Rival rivalone" });
    const d = (await w.owner.agent.get(`/workspaces/${w.ws}/competitors/${r.body.data.id}`)).body.data;
    expect(d.followers).toMatchObject({ latest: 1000, change: null });                       // one snapshot: growth unknown, not 0
    expect(d.posts).toMatchObject({ inRange: 2, withInteractionData: 2 });
    expect(d.publicInteractionsPerPost).toMatchObject({ median: 33, mean: 33 });            // (10+2+3+0 = 15) and (40+5+5+1 = 51): impressions are not part of the public interaction count
    expect(d.topPosts[0]).toMatchObject({ url: "u2", interactions: 51 });
    expect(d.basis).toMatch(/Public data only/);
  });

  it("follower change needs an earlier snapshot; later collections add history without rewriting it", async () => {
    postsFor = () => [];
    const w = await world(t, ["x"]);
    const id = (await add(w.owner, w.ws, { platform: "x", handle: "grower" })).body.data.id;
    await t.db.query("UPDATE competitor_snapshots SET collected_at = now() - interval '10 days' WHERE competitor_id = $1", [id]);
    profileFor = (h) => ({ externalId: `ext-${h}`, handle: h, displayName: "G", followers: 1250, posts: 41 });
    await t.db.query("UPDATE competitors SET status = 'disabled' WHERE id <> $1", [id]);   // keep other tests' competitors out of this sweep
    await forceDue(id);
    expect(await t.deps.engine.competitors.sweep()).toMatchObject({ collected: 1 });
    const from = day(5).toISOString().slice(0, 10);
    const d = (await w.owner.agent.get(`/workspaces/${w.ws}/competitors/${id}?from=${from}`)).body.data;
    expect(d.followers).toMatchObject({ latest: 1250, change: 250 });
    expect((await t.db.query("SELECT 1 FROM competitor_snapshots WHERE competitor_id = $1", [id])).rowCount).toBe(2);
    profileFor = (h) => ({ externalId: `ext-${h}`, handle: h, displayName: `Rival ${h}`, followers: 1000, posts: 40 });
  });

  it("refuses what the platforms do not offer, and what would be wrong", async () => {
    const w = await world(t, ["x", "linkedin"]);
    const li2 = await add(w.owner, w.ws, { platform: "linkedin", handle: "someone" });
    expect(li2.status).toBe(422);
    expect(li2.body.error.code).toBe("CAPABILITY_UNSUPPORTED");
    expect((await add(w.owner, w.ws, { platform: "instagram", handle: "someone" })).body.error.code).toBe("CAPABILITY_UNSUPPORTED");   // not configured / not supported
    const bare = await world(t, []);
    expect((await add(bare.owner, bare.ws, { platform: "x", handle: "rival" })).body.error.code).toBe("NEEDS_CONNECTED_ACCOUNT");
    await add(w.owner, w.ws, { platform: "x", handle: "dup" });
    expect((await add(w.owner, w.ws, { platform: "x", handle: "dup" })).body.error.code).toBe("ALREADY_TRACKED");
    const ownHandle = (await t.db.query<{ external_id: string }>("SELECT external_id FROM social_accounts WHERE workspace_id = $1 AND platform = 'x'", [w.ws])).rows[0]!.external_id;
    const old = profileFor; profileFor = (h) => ({ externalId: ownHandle, handle: h, displayName: "me", followers: 1, posts: 1 });
    expect((await add(w.owner, w.ws, { platform: "x", handle: "myself" })).status).toBe(400);
    profileFor = old;
    failProfile = new PlatformError("permanent", "No X account found for @ghost");
    expect((await add(w.owner, w.ws, { platform: "x", handle: "ghost" })).body.error.code).toBe("COMPETITOR_NOT_FOUND");
    failProfile = new PlatformError("rate_limited", "429", { retryAfterS: 600 });
    expect((await add(w.owner, w.ws, { platform: "x", handle: "limited" })).status).toBe(429);
    failProfile = null;
    for (let i = 0; i < 9; i++) await add(w.owner, w.ws, { platform: "x", handle: `bulk${i}` });
    expect((await add(w.owner, w.ws, { platform: "x", handle: "one-too-many" })).body.error.code).toBe("COMPETITOR_LIMIT");
  });

  it("collection failures back off and disable the competitor after repeated permanent errors; nothing else is affected", async () => {
    const w = await world(t, ["x"]);
    const id = (await add(w.owner, w.ws, { platform: "x", handle: "flaky" })).body.data.id;
    failProfile = new PlatformError("permanent", "account suspended");
    for (let i = 0; i < 5; i++) { await forceDue(id); await t.deps.engine.competitors.sweep(); }
    failProfile = null;
    expect((await t.db.query("SELECT status, failures, last_error FROM competitors WHERE id = $1", [id])).rows[0]).toMatchObject({ status: "disabled", failures: 5, last_error: "account suspended" });
    expect((await t.db.query("SELECT 1 FROM competitor_snapshots WHERE competitor_id = $1", [id])).rowCount).toBe(1);   // history kept
    await forceDue(id);
    expect((await t.deps.engine.competitors.sweep()).due).toBe(0);                                                     // disabled ones are not polled
  });

  it("compares you with competitors on PUBLIC metrics only (your private metrics such as bookmarks are excluded)", async () => {
    postsFor = () => [{ externalId: "c1", publishedAt: day(1), metrics: { likes: 30, comments: 0, reposts: 0, quotes: 0 } }, { externalId: "c2", publishedAt: day(2), metrics: { likes: 10, comments: 0, reposts: 0, quotes: 0 } }];
    const w = await world(t, ["x"]);
    const acct = w.accounts.x!;
    const post = (await w.owner.agent.post(`/workspaces/${w.ws}/posts`).send({ body: "mine", variants: [{ accountId: acct }] })).body.data.id;
    const v = (await t.db.query<{ id: string }>("SELECT id FROM post_variants WHERE post_id = $1", [post])).rows[0]!.id;
    await t.db.query("INSERT INTO publishing_jobs (workspace_id, post_id, variant_id, social_account_id, platform, status, next_attempt_at, published_at, external_id, created_by, idempotency_key) VALUES ($1,$2,$3,$4,'x','published',$5,$5,'mine-1',$6,'k1')", [w.ws, post, v, acct, day(1).toISOString(), w.owner.id]);
    await t.deps.engine.analytics.sweep();
    while (t.analyticsQueued.length) await t.deps.engine.analytics.collect(t.analyticsQueued.shift()!);
    await add(w.owner, w.ws, { platform: "x", handle: "rivaltwo" });
    const c = (await w.owner.agent.get(`/workspaces/${w.ws}/competitors/compare?platform=x`)).body.data;
    expect(c.you.publicInteractionsPerPost.median).toBe(26);                  // 20 likes + 2 replies + 3 reposts + 1 quote; the 999 bookmarks are NOT counted
    expect(c.you.posts.inRange).toBe(1);
    expect(c.competitors[0].publicInteractionsPerPost.median).toBe(20);
    expect(c.competitors[0].posts.inRange).toBe(2);
    expect(c.basis).toMatch(/publicly visible/);
    expect((await w.owner.agent.get(`/workspaces/${w.ws}/competitors/compare`)).status).toBe(400);
  });

  it("authorization and tenant isolation", async () => {
    postsFor = () => [];
    const w = await world(t, ["x"]);
    const id = (await add(w.owner, w.ws, { platform: "x", handle: "secretrival" })).body.data.id;
    const stranger = await t.newUser("s"), viewer = await t.newUser("v"), analyst = await t.newUser("a");
    await t.db.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'viewer'),($1,$3,'analyst')", [w.ws, viewer.id, analyst.id]);
    for (const r of [await stranger.agent.get(`/workspaces/${w.ws}/competitors`), await add(stranger, w.ws, { platform: "x", handle: "zz" }), await stranger.agent.delete(`/workspaces/${w.ws}/competitors/${id}`)]) expect(r.status).toBe(404);
    expect((await viewer.agent.get(`/workspaces/${w.ws}/competitors`)).status).toBe(403);
    expect((await analyst.agent.get(`/workspaces/${w.ws}/competitors/${id}`)).status).toBe(200);
    expect((await add(analyst, w.ws, { platform: "x", handle: "zz" })).status).toBe(403);
    expect((await analyst.agent.delete(`/workspaces/${w.ws}/competitors/${id}`)).status).toBe(403);
    const other = await world(t, ["x"]);
    expect((await other.owner.agent.get(`/workspaces/${other.ws}/competitors/${id}`)).status).toBe(404);
    expect((await w.owner.agent.delete(`/workspaces/${w.ws}/competitors/${id}`)).status).toBe(204);
    expect((await t.db.query("SELECT 1 FROM competitor_snapshots WHERE competitor_id = $1", [id])).rowCount).toBe(0);   // deleting removes collected data
  });
});
