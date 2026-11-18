import { describe, it, expect, afterAll } from "vitest";
import { transition, type SubStatus } from "../src/modules/billing/billing.state.js";
import { createFakeAdapter, ok } from "./helpers/fake-adapter.js";
import { createTestApp } from "./helpers/app.js";
import { world, type T } from "./helpers/world.js";

const sub = (t: T, ws: string, plan: string, status: SubStatus, extra = "") =>
  t.db.query(`INSERT INTO billing_subscriptions (workspace_id, plan_version_id, status, currency, interval ${extra ? ", provider, provider_subscription_id" : ""})
    SELECT $1, v.id, $3, 'INR', 'month' ${extra ? ", 'dodo', $4" : ""} FROM billing_plan_versions v JOIN billing_plans p ON p.id = v.plan_id WHERE v.active AND p.key = $2`, extra ? [ws, plan, status, extra] : [ws, plan, status]);

describe("billing foundation", async () => {
  const t = await createTestApp([createFakeAdapter("linkedin", () => ok()).adapter]);
  afterAll(t.close);
  const { billing } = t.deps;

  it("state machine: canceled is terminal; invalid events are ignored (null), not applied", () => {
    expect(transition("incomplete", "activated")).toBe("active");
    expect(transition("active", "payment_failed")).toBe("past_due");
    expect(transition("past_due", "payment_succeeded")).toBe("active");
    expect(transition("canceled", "activated")).toBeNull();
    expect(transition("canceled", "payment_succeeded")).toBeNull();
    expect(transition("incomplete", "payment_failed")).toBeNull();
  });

  it("catalog: integer minor-unit prices, immutable versions", async () => {
    const owner = await t.newUser("c");
    const plans = (await owner.agent.get("/billing/plans")).body.data as { key: string; prices: { currency: string; amountMinor: number }[] }[];
    expect(plans.map((p) => p.key)).toEqual(["free", "starter", "pro", "agency"]);
    for (const p of plans) for (const pr of p.prices) expect(Number.isInteger(pr.amountMinor)).toBe(true);
    expect(plans.find((p) => p.key === "free")!.prices).toEqual([]);
    // Every paid plan sells monthly and yearly, in USD (international) and INR (India); yearly = 10 months.
    for (const p of plans.filter((x) => x.key !== "free")) {
      const pr = p.prices as { currency: string; interval: string; amountMinor: number }[];
      expect(pr.map((x) => `${x.currency}/${x.interval}`).sort(), p.key).toEqual(["INR/month", "INR/year", "USD/month", "USD/year"]);
      for (const cur of ["INR", "USD"]) expect(pr.find((x) => x.currency === cur && x.interval === "year")!.amountMinor, `${p.key} ${cur}`).toBe(pr.find((x) => x.currency === cur && x.interval === "month")!.amountMinor * 10);
    }
    expect(plans.find((p) => p.key === "starter")!.prices).toContainEqual({ currency: "USD", interval: "month", amountMinor: 1500 });
    await expect(t.db.query("UPDATE billing_prices SET amount_minor = 1")).rejects.toThrow(/immutable/);
    await t.db.query("UPDATE billing_prices SET provider_refs = '{\"dodo\":\"x\"}'");   // mapping is allowed
    await expect(t.db.query("UPDATE billing_entitlements SET limit_value = 1")).rejects.toThrow(/immutable/);
    await expect(t.db.query("DELETE FROM billing_prices")).rejects.toThrow(/immutable/);
  });

  it("billing endpoint: owner/admin read; editor 403; stranger 404; defaults to Free", async () => {
    const { owner, ws } = await world(t, ["linkedin"]);
    const o = (await owner.agent.get(`/workspaces/${ws}/billing`)).body.data;
    expect(o.plan.key).toBe("free");
    expect(o.subscription).toBeNull();
    expect(o.features.find((f: { feature: string }) => f.feature === "connected_accounts")).toMatchObject({ limit: 3, used: 1, remaining: 2 });
    for (const [role, status] of [["admin", 200], ["editor", 403], ["analyst", 403]] as const) {
      const u = await t.newUser(role);
      await t.db.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,$3)", [ws, u.id, role]);
      expect((await u.agent.get(`/workspaces/${ws}/billing`)).status, role).toBe(status);
    }
    expect((await (await t.newUser("s")).agent.get(`/workspaces/${ws}/billing`)).status).toBe(404);
  });

  it("entitlements: count limit enforced with 402; plan upgrade lifts it; non-granting states fall back to Free", async () => {
    const { ws } = await world(t, ["linkedin"]);
    expect((await billing.check(ws, "seats", 1))).toMatchObject({ allowed: false, limit: 1, used: 1, reason: "limit_reached" });
    await expect(billing.enforce(ws, "seats")).rejects.toMatchObject({ status: 402, code: "PLAN_LIMIT_REACHED" });
    await sub(t, ws, "pro", "incomplete");                                         // unpaid: no access
    expect((await billing.check(ws, "seats")).allowed).toBe(false);
    await t.db.query("UPDATE billing_subscriptions SET status = 'active' WHERE workspace_id = $1", [ws]);
    expect(await billing.check(ws, "seats")).toMatchObject({ allowed: true, limit: 10, plan: "pro" });
    await t.db.query("UPDATE billing_subscriptions SET status = 'past_due' WHERE workspace_id = $1", [ws]);
    expect((await billing.check(ws, "seats")).plan).toBe("pro");                    // grace while past_due
    await t.db.query("UPDATE billing_subscriptions SET status = 'canceled' WHERE workspace_id = $1", [ws]);
    expect((await billing.check(ws, "seats")).plan).toBe("free");
  });

  it("flags and unknown features: free has MCP capped at 10 AI posts a month, paid plans are uncapped; unknown feature is denied", async () => {
    const { ws } = await world(t, ["linkedin"]);
    expect((await billing.check(ws, "mcp_access")).allowed).toBe(true);
    expect(await billing.check(ws, "mcp_posts_per_month")).toMatchObject({ allowed: true, limit: 10, used: 0 });
    expect((await billing.check(ws, "no_such_feature")).allowed).toBe(false);
    await sub(t, ws, "starter", "active");
    expect((await billing.check(ws, "mcp_access")).allowed).toBe(true);
    expect((await billing.check(ws, "mcp_posts_per_month")).reason).toBe("not_in_plan");   // no row = no AI-post cap (publish_post treats it as unlimited)
  });

  it("usage is idempotent per key and gates at the monthly limit", async () => {
    const { ws } = await world(t, ["linkedin"]);
    expect(await billing.recordUsage(ws, "posts_per_month", 29, "k1")).toEqual({ recorded: true });
    expect(await billing.recordUsage(ws, "posts_per_month", 29, "k1")).toEqual({ recorded: false });   // retry: no double count
    expect(await billing.check(ws, "posts_per_month", 1)).toMatchObject({ allowed: true, used: 29, remaining: 1 });
    expect((await billing.check(ws, "posts_per_month", 2)).allowed).toBe(false);
    await billing.recordUsage(ws, "posts_per_month", 1, "k2");
    expect(await billing.check(ws, "posts_per_month", 1)).toMatchObject({ allowed: false, reason: "limit_reached" });
    await expect(t.db.query("UPDATE billing_usage_events SET quantity = 1")).rejects.toThrow(/immutable/);
  });

  it("one live subscription per workspace; provider subscription id is unique", async () => {
    const { ws } = await world(t, ["linkedin"]);
    const other = await world(t, ["linkedin"]);
    await sub(t, ws, "pro", "active", "sub_1");
    await expect(sub(t, ws, "starter", "active")).rejects.toThrow();
    await expect(sub(t, other.ws, "pro", "active", "sub_1")).rejects.toThrow();
    await t.db.query("UPDATE billing_subscriptions SET status = 'canceled' WHERE workspace_id = $1", [ws]);
    await sub(t, ws, "starter", "active");                                          // resubscribe = new row
  });

  it("tenant isolation: usage and plans never cross workspaces", async () => {
    const a = await world(t, ["linkedin"]), b = await world(t, ["linkedin"]);
    await billing.recordUsage(a.ws, "posts_per_month", 10, "same-key");
    await billing.recordUsage(b.ws, "posts_per_month", 5, "same-key");               // same key, other tenant: independent
    expect((await billing.check(a.ws, "posts_per_month")).used).toBe(10);
    expect((await billing.check(b.ws, "posts_per_month")).used).toBe(5);
  });
});
