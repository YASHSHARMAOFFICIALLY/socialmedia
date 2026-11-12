import { describe, it, expect, afterAll } from "vitest";
import { createFakeAdapter, ok } from "./helpers/fake-adapter.js";
import { createTestApp } from "./helpers/app.js";
import { drain, publish, seedAccount, world } from "./helpers/world.js";

const upgrade = (t: Awaited<ReturnType<typeof createTestApp>>, ws: string, plan: string) => t.db.query("INSERT INTO billing_subscriptions (workspace_id, plan_version_id, status, currency, interval) SELECT $1, v.id, 'active', 'INR', 'month' FROM billing_plan_versions v JOIN billing_plans p ON p.id = v.plan_id WHERE p.key = $2", [ws, plan]);
const usage = async (t: Awaited<ReturnType<typeof createTestApp>>, ws: string) => (await t.db.query<{ n: number }>("SELECT COALESCE(sum(quantity),0)::int AS n FROM billing_usage_events WHERE workspace_id = $1 AND feature_key = 'posts_per_month'", [ws])).rows[0]!.n;

describe("plan limits on REST (BILLING_ENFORCE=true)", async () => {
  const li = createFakeAdapter("linkedin", () => ok());
  const t = await createTestApp([li.adapter], { env: { BILLING_ENFORCE: "true" } });
  afterAll(t.close);

  it("seats: Free allows one member, so inviting is a 402 PLAN_LIMIT_REACHED; Pro allows it; accepting an old invite into a full workspace is refused", async () => {
    const { owner, ws } = await world(t, ["linkedin"]);
    const blocked = await owner.agent.post(`/workspaces/${ws}/invitations`).send({ email: "a@b.test", role: "editor" });
    expect(blocked.status).toBe(402);
    expect(blocked.body.error).toMatchObject({ code: "PLAN_LIMIT_REACHED", details: { feature: "seats", limit: 1, used: 1 } });
    await upgrade(t, ws, "starter");                                                    // 3 seats
    expect((await owner.agent.post(`/workspaces/${ws}/invitations`).send({ email: "a@b.test", role: "editor" })).status).toBe(201);
  });

  it("connected accounts: the 4th connect on Free is refused before any OAuth starts", async () => {
    const { owner, ws } = await world(t, ["linkedin"]);
    await seedAccount(t, ws, owner, "linkedin"); await seedAccount(t, ws, owner, "linkedin");   // now 3
    const r = await owner.agent.post(`/workspaces/${ws}/accounts/connect`).send({ platform: "linkedin" });
    expect(r.status).toBe(402);
    expect(r.body.error.details).toMatchObject({ feature: "connected_accounts", limit: 3, used: 3 });
    expect((await t.db.query("SELECT 1 FROM oauth_states WHERE workspace_id = $1", [ws]).catch(() => ({ rowCount: 0 }))).rowCount).toBe(0);
  });

  it("posts: publishing meters one unit per PUBLISHED destination (once), and the monthly limit blocks new publications", async () => {
    const { owner, ws, post } = await world(t, ["linkedin"]);
    expect((await publish(owner, ws, post)).status).toBe(202);
    expect(await usage(t, ws)).toBe(0);                                                 // queued is not published: nothing metered yet
    expect(await drain(t)).toEqual(["published"]);
    expect(await usage(t, ws)).toBe(1);
    await t.deps.billing.recordUsage(ws, "posts_per_month", 29, "bulk");               // 30 used = Free limit
    const second = (await owner.agent.post(`/workspaces/${ws}/posts`).send({ body: "two", variants: [{ accountId: (await t.db.query<{ id: string }>("SELECT id FROM social_accounts WHERE workspace_id = $1", [ws])).rows[0]!.id }] })).body.data.id;
    const res = await publish(owner, ws, second);
    expect(res.status).toBe(402);
    expect(res.body.error.details).toMatchObject({ feature: "posts_per_month", limit: 30, used: 30 });
    expect((await t.db.query("SELECT 1 FROM publishing_jobs WHERE post_id = $1", [second])).rowCount).toBe(0);   // nothing was created
  });
});

describe("posts_per_month counts accepted-but-unpublished jobs", async () => {
  const t = await createTestApp([createFakeAdapter("linkedin", () => ok()).adapter], { env: { BILLING_ENFORCE: "true" } });
  afterAll(t.close);
  it("queued/scheduled posts consume the limit before anything has published", async () => {
    const { owner, ws, post } = await world(t, ["linkedin"]);
    expect((await publish(owner, ws, post)).status).toBe(202);                           // queued, not published: counts as 1
    await t.deps.billing.recordUsage(ws, "posts_per_month", 29, "bulk");                // 29 published + 1 queued = 30 = Free limit
    const acc = (await t.db.query<{ id: string }>("SELECT id FROM social_accounts WHERE workspace_id = $1", [ws])).rows[0]!.id;
    const second = (await owner.agent.post(`/workspaces/${ws}/posts`).send({ body: "two", variants: [{ accountId: acc }] })).body.data.id;
    const res = await publish(owner, ws, second);
    expect(res.status).toBe(402);
    expect(res.body.error.details).toMatchObject({ feature: "posts_per_month", used: 30 });
    await drain(t);                                                                      // the queued one publishes: still exactly 30, not 31
    expect((await t.deps.billing.check(ws, "posts_per_month")).used).toBe(30);
  });
});

describe("analytics_history_days", async () => {
  const t = await createTestApp([createFakeAdapter("linkedin", () => ok()).adapter], { env: { BILLING_ENFORCE: "true" } });
  afterAll(t.close);
  const ago = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
  it("Free looks back 30 days, Starter 90; the default range always works", async () => {
    const { owner, ws } = await world(t, ["linkedin"]);
    const get = (from?: string) => owner.agent.get(`/workspaces/${ws}/analytics/overview${from ? `?from=${from}` : ""}`);
    expect((await get()).status).toBe(200);
    const r = await get(ago(100));
    expect(r.status).toBe(402);
    expect(r.body.error.details).toMatchObject({ feature: "analytics_history_days", limit: 30 });
    await upgrade(t, ws, "starter");
    expect((await get(ago(80))).status).toBe(200);
    expect((await get(ago(100))).status).toBe(402);
  });
});

describe("billing not enforced (default)", async () => {
  const t = await createTestApp([createFakeAdapter("linkedin", () => ok()).adapter]);
  afterAll(t.close);
  it("Free workspaces are not limited on REST until BILLING_ENFORCE is switched on, but publishing is still metered", async () => {
    const { owner, ws, post } = await world(t, ["linkedin"]);
    expect((await owner.agent.post(`/workspaces/${ws}/invitations`).send({ email: "a@b.test", role: "editor" })).status).toBe(201);
    await publish(owner, ws, post); await drain(t);
    expect(await usage(t, ws)).toBe(1);
  });
});
