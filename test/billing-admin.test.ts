import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { createFakeAdapter, ok } from "./helpers/fake-adapter.js";
import { createTestApp } from "./helpers/app.js";
import { world } from "./helpers/world.js";

const OPS = "ops-token-ops-token-ops-token-123";
describe("billing endpoints for a UI + operator admin", async () => {
  const t = await createTestApp([createFakeAdapter("linkedin", () => ok()).adapter], { env: { OPS_TOKEN: OPS } });
  afterAll(t.close);
  const admin = (m: "get" | "post" | "put", path: string, token: string | null = OPS) => { const r = request(t.app)[m](path); return token ? r.set("authorization", `Bearer ${token}`) : r; };

  it("operator endpoints: 401 without/with a wrong token, never reachable by user sessions", async () => {
    expect((await admin("get", "/admin/billing/webhook-events", null)).status).toBe(401);
    expect((await admin("get", "/admin/billing/webhook-events", "wrong-token-wrong-token-wrong")).status).toBe(401);
    const { owner } = await world(t, ["linkedin"]);
    expect((await owner.agent.get("/admin/billing/webhook-events")).status).toBe(401);
    expect((await admin("get", "/admin/billing/webhook-events")).status).toBe(200);
    const off = await createTestApp([]);
    expect((await request(off.app).get("/admin/billing/webhook-events").set("authorization", `Bearer ${OPS}`)).status).toBe(404);   // disabled when no OPS_TOKEN
    await off.close();
  });

  it("summary: subscriber counts per plan/status, MRR per currency (yearly / 12, cancelling ones excluded), webhook health", async () => {
    const ins = (ws: string, interval: string, cancelAtEnd = false) => t.db.query("INSERT INTO billing_subscriptions (workspace_id, plan_version_id, status, currency, interval, cancel_at_period_end) SELECT $1, v.id, 'active', 'USD', $2, $3 FROM billing_plan_versions v JOIN billing_plans p ON p.id = v.plan_id WHERE p.key = 'starter' AND v.active", [ws, interval, cancelAtEnd]);
    await t.db.query("DELETE FROM billing_subscriptions");
    await t.db.query("INSERT INTO billing_prices (plan_version_id, currency, interval, amount_minor) SELECT v.id, 'USD', 'year', 9000 FROM billing_plan_versions v JOIN billing_plans p ON p.id = v.plan_id WHERE p.key = 'starter' AND v.active ON CONFLICT DO NOTHING");   // seed has monthly prices only
    const a = await world(t, ["linkedin"]), b = await world(t, ["linkedin"]), c = await world(t, ["linkedin"]);
    await ins(a.ws, "month"); await ins(b.ws, "year"); await ins(c.ws, "month", true);
    const price = async (interval: string) => Number((await t.db.query<{ a: string }>("SELECT pr.amount_minor::text AS a FROM billing_prices pr JOIN billing_plan_versions v ON v.id = pr.plan_version_id JOIN billing_plans p ON p.id = v.plan_id WHERE p.key = 'starter' AND v.active AND pr.currency = 'USD' AND pr.interval = $1", [interval])).rows[0]!.a);
    const r = await admin("get", "/admin/billing/summary");
    expect(r.status).toBe(200);
    expect(r.body.data.subscriptions.find((s: { plan: string; status: string; currency: string }) => s.plan === "starter" && s.status === "active" && s.currency === "USD").n).toBe(3);
    expect(r.body.data.mrrMinorByCurrency.USD).toBe(Math.round((await price("month")) + (await price("year")) / 12));
    expect((await admin("get", "/admin/billing/summary", null)).status).toBe(401);
  });

  it("publishing a plan version sets real prices without touching existing subscribers; provider refs are set per version", async () => {
    const { owner, ws } = await world(t, ["linkedin"]);
    await t.db.query("INSERT INTO billing_subscriptions (workspace_id, plan_version_id, status, currency, interval) SELECT $1, v.id, 'active', 'INR', 'month' FROM billing_plan_versions v JOIN billing_plans p ON p.id = v.plan_id WHERE p.key = 'pro'", [ws]);
    const body = { prices: [{ currency: "INR", interval: "month", amountMinor: 249900 }, { currency: "USD", interval: "month", amountMinor: 2900 }], entitlements: [{ feature: "seats", kind: "count", limit: 15 }, { feature: "mcp_access", kind: "flag", limit: 1 }] };
    const r = await admin("post", "/admin/billing/plans/pro/versions").send(body);
    expect(r.status).toBe(201);
    expect(r.body.data.version).toBe(2);
    const plans = (await owner.agent.get("/billing/plans")).body.data;
    const pro = plans.find((p: { key: string }) => p.key === "pro");
    expect(pro).toMatchObject({ version: 2, prices: [{ currency: "INR", interval: "month", amountMinor: 249900 }, { currency: "USD", interval: "month", amountMinor: 2900 }] });
    expect((await t.deps.billing.check(ws, "seats")).limit).toBe(10);                         // grandfathered on version 1
    expect((await admin("put", "/admin/billing/plans/pro/prices/INR/month/provider-ref").send({ provider: "dodo", ref: "pdt_new" })).status).toBe(204);
    expect((await t.db.query<{ r: string }>("SELECT provider_refs->>'dodo' AS r FROM billing_prices pr JOIN billing_plan_versions v ON v.id = pr.plan_version_id JOIN billing_plans p ON p.id = v.plan_id WHERE p.key = 'pro' AND v.version = 2 AND pr.currency = 'INR'")).rows[0]!.r).toBe("pdt_new");
    expect((await admin("put", "/admin/billing/plans/pro/prices/USD/year/provider-ref").send({ provider: "dodo", ref: "x" })).status).toBe(404);
    expect((await admin("post", "/admin/billing/plans/free/versions").send({ ...body })).status).toBe(400);   // free has no prices
    expect((await admin("post", "/admin/billing/plans/pro/versions").send({ ...body, prices: [body.prices[0], body.prices[0]] })).status).toBe(400);
    expect((await admin("post", "/admin/billing/plans/pro/versions").send({ ...body, prices: [{ currency: "INR", interval: "month", amountMinor: 99.5 }] })).status).toBe(400);   // money is integer minor units
    expect((await admin("post", "/admin/billing/plans/nope/versions").send(body)).status).toBe(404);
    expect((await t.db.query("SELECT 1 FROM audit_logs WHERE action = 'billing.admin.plan_version_published'")).rowCount).toBe(1);
  });

  it("failed webhook events are listed and can be retried by the operator", async () => {
    const id = (await t.db.query<{ id: string }>("INSERT INTO billing_webhook_events (provider, event_id, event_type, payload, status, attempts, last_error) VALUES ('dodo','evt_x','subscription.active','{\"subscriptionId\":null,\"payment\":null}','failed',8,'boom') RETURNING id")).rows[0]!.id;
    expect((await admin("get", "/admin/billing/webhook-events?status=failed")).body.data.map((e: { id: string }) => e.id)).toContain(id);
    expect((await admin("post", `/admin/billing/webhook-events/${id}/retry`)).status).toBe(200);
    await t.db.query("UPDATE billing_webhook_events SET status = 'processed' WHERE id = $1", [id]);
    expect((await admin("post", `/admin/billing/webhook-events/${id}/retry`)).status).toBe(404);        // processed events are never replayed
  });

  it("payments list and portal endpoints follow the same authorization rules", async () => {
    const { owner, ws } = await world(t, ["linkedin"]);
    await t.db.query("INSERT INTO billing_payments (workspace_id, provider, provider_payment_id, status, amount_minor, currency) VALUES ($1,'dodo','p1','succeeded',199900,'INR')", [ws]);
    expect((await owner.agent.get(`/workspaces/${ws}/billing/payments`)).body.data).toMatchObject([{ status: "succeeded", amountMinor: 199900, currency: "INR" }]);
    expect((await owner.agent.post(`/workspaces/${ws}/billing/portal`)).status).toBe(503);              // payments not configured in this app
  });
});
