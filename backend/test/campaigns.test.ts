import { describe, it, expect, afterAll } from "vitest";
import { createFakeAdapter, metricsOf, ok } from "./helpers/fake-adapter.js";
import { createTestApp } from "./helpers/app.js";
import { world, type T, type U } from "./helpers/world.js";

const iso = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
async function published(t: T, ws: string, owner: U, accountId: string, platform: string, externalId: string, daysAgo = 1) {
  const post = (await owner.agent.post(`/workspaces/${ws}/posts`).send({ body: externalId, variants: [{ accountId }] })).body.data.id as string;
  const v = (await t.db.query<{ id: string }>("SELECT id FROM post_variants WHERE post_id = $1", [post])).rows[0]!.id;
  await t.db.query("INSERT INTO publishing_jobs (workspace_id, post_id, variant_id, social_account_id, platform, status, next_attempt_at, published_at, external_id, created_by, idempotency_key) VALUES ($1,$2,$3,$4,$5,'published',$6,$6,$7,$8,$9)", [ws, post, v, accountId, platform, iso(daysAgo), externalId, owner.id, `k${Math.random()}`]);
  return post;
}

describe("campaigns", async () => {
  const x = createFakeAdapter("x", () => ok(), { postMetrics: (_n: number, id: string) => metricsOf({ "public_metrics.impression_count": 100, "public_metrics.like_count": id.startsWith("a") ? 10 : 50 }) });
  const yt = createFakeAdapter("youtube", () => ok(), { postMetrics: () => metricsOf({ "statistics.viewCount": 900, "statistics.likeCount": 20, "statistics.commentCount": 2 }) });
  const t = await createTestApp([x.adapter, yt.adapter]);
  afterAll(t.close);

  it("CRUD, validation, archive, pagination", async () => {
    const { owner, ws } = await world(t, ["x"]);
    const mk = (b: object) => owner.agent.post(`/workspaces/${ws}/campaigns`).send(b);
    const c = await mk({ name: "Product Launch November", startDate: "2026-11-01", endDate: "2026-11-30" });
    expect(c.status).toBe(201);
    expect((await mk({ name: "x", startDate: "2026-11-10", endDate: "2026-11-01" })).status).toBe(400);
    expect((await mk({ name: "" })).status).toBe(400);
    const id = c.body.data.id;
    expect((await owner.agent.patch(`/workspaces/${ws}/campaigns/${id}`).send({ endDate: "2026-10-01" })).status).toBe(400);   // before the stored start
    expect((await owner.agent.patch(`/workspaces/${ws}/campaigns/${id}`).send({ description: "d", status: "archived" })).body.data).toMatchObject({ description: "d", status: "archived" });
    await mk({ name: "Second" }); await mk({ name: "Third" });
    const p1 = (await owner.agent.get(`/workspaces/${ws}/campaigns?limit=2`)).body;
    expect(p1.data).toHaveLength(2);
    expect((await owner.agent.get(`/workspaces/${ws}/campaigns?limit=2&cursor=${p1.meta.nextCursor}`)).body.data).toHaveLength(1);
    expect((await owner.agent.get(`/workspaces/${ws}/campaigns?status=archived`)).body.data).toHaveLength(1);
  });

  it("posts belong to at most one campaign; moves are reported; foreign posts are rejected", async () => {
    const a = await world(t, ["x"]), b = await world(t, ["x"]);
    const c1 = (await a.owner.agent.post(`/workspaces/${a.ws}/campaigns`).send({ name: "C1" })).body.data.id;
    const c2 = (await a.owner.agent.post(`/workspaces/${a.ws}/campaigns`).send({ name: "C2" })).body.data.id;
    expect((await a.owner.agent.post(`/workspaces/${a.ws}/campaigns/${c1}/posts`).send({ postIds: [a.post] })).body.data).toEqual({ added: 1, moved: [] });
    const moved = await a.owner.agent.post(`/workspaces/${a.ws}/campaigns/${c2}/posts`).send({ postIds: [a.post] });
    expect(moved.body.data.moved).toEqual([{ postId: a.post, fromCampaignId: c1 }]);
    expect((await a.owner.agent.get(`/workspaces/${a.ws}/campaigns/${c1}`)).body.data.postCount).toBe(0);
    expect((await a.owner.agent.get(`/workspaces/${a.ws}/campaigns/${c2}`)).body.data.postCount).toBe(1);
    expect((await a.owner.agent.post(`/workspaces/${a.ws}/campaigns/${c1}/posts`).send({ postIds: [b.post] })).status).toBe(400);   // other tenant's post
    expect((await a.owner.agent.delete(`/workspaces/${a.ws}/campaigns/${c2}/posts/${a.post}`)).status).toBe(204);
    expect((await a.owner.agent.delete(`/workspaces/${a.ws}/campaigns/${c2}/posts/${a.post}`)).status).toBe(404);
  });

  it("performance: per-platform contribution, comparable totals only, publishing status; campaign scoping excludes other posts", async () => {
    const { owner, ws, accounts } = await world(t, ["x", "youtube"]);
    const p1 = await published(t, ws, owner, accounts.x!, "x", "a-1");
    const p2 = await published(t, ws, owner, accounts.youtube!, "youtube", "yt-1");
    const outside = await published(t, ws, owner, accounts.x!, "x", "b-outside");
    const camp = (await owner.agent.post(`/workspaces/${ws}/campaigns`).send({ name: "Launch" })).body.data.id;
    await owner.agent.post(`/workspaces/${ws}/campaigns/${camp}/posts`).send({ postIds: [p1, p2] });
    await t.deps.engine.analytics.sweep();
    while (t.analyticsQueued.length) await t.deps.engine.analytics.collect(t.analyticsQueued.shift()!);
    const perf = (await owner.agent.get(`/workspaces/${ws}/campaigns/${camp}/performance`)).body.data;
    const px = perf.platforms.find((p: { platform: string }) => p.platform === "x");
    expect(px.metrics.likes.total).toBe(10);                                  // only the campaign's X post (a-1), not b-outside (50)
    expect(px.posts.tracked).toBe(1);
    expect(perf.totals.map((x: { key: string }) => x.key).sort()).toEqual(["comments", "interactions", "likes"]);
    expect(perf.totals.find((x: { key: string }) => x.key === "likes")).toMatchObject({ total: 30, perPlatform: { x: 10, youtube: 20 } });
    expect(perf.notSummed.map((x: { key: string }) => x.key)).toEqual(expect.arrayContaining(["views", "impressions"]));
    const share = Object.fromEntries(perf.platformContribution.map((c: { platform: string; share: number }) => [c.platform, c.share]));
    expect(share.x + share.youtube).toBeCloseTo(1, 5);
    expect(perf.publishing).toEqual({ x: { published: 1 }, youtube: { published: 1 } });
    const detail = (await owner.agent.get(`/workspaces/${ws}/campaigns/${camp}`)).body.data;
    expect(detail.publishing.x.published).toBe(1);
    void outside;
  });

  it("compares campaigns without mixing definitions", async () => {
    const { owner, ws, accounts } = await world(t, ["x"]);
    const pa = await published(t, ws, owner, accounts.x!, "x", "a-2");
    const pb = await published(t, ws, owner, accounts.x!, "x", "b-2");
    const [ca, cb] = [(await owner.agent.post(`/workspaces/${ws}/campaigns`).send({ name: "A" })).body.data.id, (await owner.agent.post(`/workspaces/${ws}/campaigns`).send({ name: "B" })).body.data.id];
    await owner.agent.post(`/workspaces/${ws}/campaigns/${ca}/posts`).send({ postIds: [pa] });
    await owner.agent.post(`/workspaces/${ws}/campaigns/${cb}/posts`).send({ postIds: [pb] });
    await t.deps.engine.analytics.sweep();
    while (t.analyticsQueued.length) await t.deps.engine.analytics.collect(t.analyticsQueued.shift()!);
    const cmp = (await owner.agent.get(`/workspaces/${ws}/campaigns/compare?ids=${ca},${cb}`)).body.data.campaigns;
    expect(cmp.map((c: { platforms: { metrics: { likes: { total: number } } }[] }) => c.platforms[0]!.metrics.likes.total)).toEqual([10, 50]);
    expect((await owner.agent.get(`/workspaces/${ws}/campaigns/compare?ids=${ca}`)).status).toBe(400);
    expect((await owner.agent.get(`/workspaces/${ws}/campaigns/compare?ids=${ca},00000000-0000-4000-8000-000000000000`)).status).toBe(404);
  });

  it("RBAC and isolation", async () => {
    const { owner, ws } = await world(t, ["x"]);
    const camp = (await owner.agent.post(`/workspaces/${ws}/campaigns`).send({ name: "Secret" })).body.data.id;
    const stranger = await t.newUser("s");
    for (const r of [await stranger.agent.get(`/workspaces/${ws}/campaigns/${camp}`), await stranger.agent.post(`/workspaces/${ws}/campaigns`).send({ name: "x" }), await stranger.agent.get(`/workspaces/${ws}/campaigns/${camp}/performance`)]) expect(r.status).toBe(404);
    const add = async (role: string) => { const u = await t.newUser(role); await t.db.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,$3)", [ws, u.id, role]); return u; };
    const viewer = await add("viewer"), analyst = await add("analyst"), editor = await add("editor");
    expect((await viewer.agent.get(`/workspaces/${ws}/campaigns/${camp}`)).status).toBe(200);
    expect((await viewer.agent.get(`/workspaces/${ws}/campaigns/${camp}/performance`)).status).toBe(403);       // needs analytics:read
    expect((await analyst.agent.get(`/workspaces/${ws}/campaigns/${camp}/performance`)).status).toBe(200);
    expect((await analyst.agent.patch(`/workspaces/${ws}/campaigns/${camp}`).send({ name: "x" })).status).toBe(403);
    expect((await editor.agent.patch(`/workspaces/${ws}/campaigns/${camp}`).send({ name: "Renamed" })).status).toBe(200);
    const other = await world(t, ["x"]);
    expect((await other.owner.agent.get(`/workspaces/${other.ws}/campaigns/${camp}`)).status).toBe(404);
  });
});
