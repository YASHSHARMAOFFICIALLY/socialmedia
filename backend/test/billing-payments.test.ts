import { createHmac } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { createDodoProvider } from "../src/integrations/payments/dodo.adapter.js";
import { createFakeAdapter, ok } from "./helpers/fake-adapter.js";
import { createTestApp } from "./helpers/app.js";
import { world } from "./helpers/world.js";

const SECRET = "whsec_" + Buffer.from("test-signing-key-0123456789").toString("base64");
const API_KEY = "dodo_test_SECRET_API_KEY_123";

/** A pretend Dodo: we script what GET /subscriptions/:id returns and record every call. */
function fakeDodo() {
  const st = { calls: [] as { method: string; path: string; body?: unknown; auth?: string }[], subs: {} as Record<string, Record<string, unknown>>, failGet: false, failPatch: false };
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname, method = init.method ?? "GET";
    st.calls.push({ method, path, auth: (init.headers as Record<string, string>).authorization, ...(init.body ? { body: JSON.parse(String(init.body)) } : {}) });
    const j = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    if (path === "/checkouts") return j({ session_id: "cks_1", checkout_url: "https://checkout.dodo.test/cks_1" });
    const m = /^\/subscriptions\/(.+)$/.exec(path);
    if (m && method === "GET") return st.failGet ? j({ message: "boom with secret" }, 500) : st.subs[m[1]!] ? j(st.subs[m[1]!]) : j({}, 404);
    if (m && method === "PATCH") return st.failPatch ? j({}, 500) : j({});
    return j({}, 404);
  }) as unknown as typeof fetch;
  return { st, fetchImpl };
}
const sign = (id: string, ts: number, body: string, secret = SECRET) =>
  "v1," + createHmac("sha256", Buffer.from(secret.replace(/^whsec_/, ""), "base64")).update(`${id}.${ts}.${body}`).digest("base64");

describe("billing payments (Dodo adapter, mocked HTTP)", async () => {
  const dodo = fakeDodo();
  const provider = createDodoProvider({ apiKey: API_KEY, webhookKey: SECRET, fetch: dodo.fetchImpl });
  const t = await createTestApp([createFakeAdapter("linkedin", () => ok()).adapter], { payments: provider });
  afterAll(t.close);
  let n = 0;
  const hook = (type: string, data: object, o: { id?: string; ts?: number; sig?: string; body?: string } = {}) => {
    const id = o.id ?? `evt_${++n}`, ts = o.ts ?? Math.floor(Date.now() / 1000);
    const body = o.body ?? JSON.stringify({ business_id: "b", type, timestamp: new Date().toISOString(), data });
    return request(t.app).post("/webhooks/dodo").set("content-type", "application/json").set("webhook-id", id).set("webhook-timestamp", String(ts)).set("webhook-signature", o.sig ?? sign(id, ts, body)).send(body);
  };
  const setRef = (plan = "pro", ref = "pdt_pro") => t.db.query("UPDATE billing_prices SET provider_refs = jsonb_build_object('dodo', $2::text) WHERE plan_version_id IN (SELECT v.id FROM billing_plan_versions v JOIN billing_plans p ON p.id = v.plan_id WHERE v.active AND p.key = $1) AND currency = 'INR' AND interval = 'month'", [plan, ref]).catch(() => null);

  it("rejects unsigned, mis-signed, tampered and stale webhooks and stores nothing", async () => {
    const before = (await t.db.query("SELECT 1 FROM billing_webhook_events")).rowCount;
    expect((await hook("subscription.active", {}, { sig: "v1,AAAA" })).status).toBe(401);
    expect((await hook("subscription.active", {}, { ts: Math.floor(Date.now() / 1000) - 3600 })).status).toBe(401);
    const id = "evt_t", ts = Math.floor(Date.now() / 1000), good = JSON.stringify({ type: "x", data: {} });
    expect((await hook("x", {}, { id, ts, body: good + " ", sig: sign(id, ts, good) })).status).toBe(401);          // body changed after signing
    expect((await hook("x", {}, { sig: sign("evt_z", 1, "{}", "whsec_" + Buffer.from("other-key-other-key-other").toString("base64")) })).status).toBe(401);
    expect((await request(t.app).post("/webhooks/dodo").send({ type: "x" })).status).toBe(401);                     // no headers at all
    expect((await t.db.query("SELECT 1 FROM billing_webhook_events")).rowCount).toBe(before);
  });

  it("checkout: not purchasable until the provider product is mapped; owner only; never grants the plan by itself", async () => {
    const { owner, ws } = await world(t, ["linkedin"]);
    const body = { plan: "pro", currency: "INR" };
    expect((await owner.agent.post(`/workspaces/${ws}/billing/checkout`).send(body)).body.error.code).toBe("PLAN_NOT_PURCHASABLE");
    await setRef();
    const admin = await t.newUser("adm");
    await t.db.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'admin')", [ws, admin.id]);
    expect((await admin.agent.post(`/workspaces/${ws}/billing/checkout`).send(body)).status).toBe(403);               // admin can read billing, not change it
    expect((await (await t.newUser("x")).agent.post(`/workspaces/${ws}/billing/checkout`).send(body)).status).toBe(404);
    const r = await owner.agent.post(`/workspaces/${ws}/billing/checkout`).send(body);
    expect(r.status).toBe(201);
    expect(r.body.data.checkoutUrl).toBe("https://checkout.dodo.test/cks_1");
    const call = dodo.st.calls.find((c) => c.path === "/checkouts")!;
    expect(call.auth).toBe(`Bearer ${API_KEY}`);
    expect(call.body).toMatchObject({ product_cart: [{ product_id: "pdt_pro", quantity: 1 }], metadata: { billing_subscription_id: r.body.data.subscriptionId, workspace_id: ws } });
    expect((await owner.agent.get(`/workspaces/${ws}/billing`)).body.data.plan.key).toBe("free");                    // paying is not paid
    expect((await owner.agent.post(`/workspaces/${ws}/billing/checkout`).send(body)).body.data.subscriptionId).toBe(r.body.data.subscriptionId);   // retry reuses the pending row
  });

  it("webhook flow: activation binds to OUR row, grants the plan once; duplicates, late and cancelled events behave", async () => {
    const { owner, ws } = await world(t, ["linkedin"]);
    await setRef();
    const subId = (await owner.agent.post(`/workspaces/${ws}/billing/checkout`).send({ plan: "pro", currency: "INR" })).body.data.subscriptionId as string;
    const live = { subscription_id: "sub_A", status: "active", product_id: "pdt_pro", currency: "INR", customer: { customer_id: "cus_1" }, metadata: { billing_subscription_id: subId, workspace_id: ws }, next_billing_date: "2030-01-01T00:00:00Z", cancel_at_next_billing_date: false };
    dodo.st.subs["sub_A"] = live;
    const first = await hook("subscription.active", { subscription_id: "sub_A" }, { id: "evt_dup" });
    expect(first.body).toEqual({ received: true, duplicate: false });
    expect((await owner.agent.get(`/workspaces/${ws}/billing`)).body.data).toMatchObject({ plan: { key: "pro" }, subscription: { status: "active", interval: "month" } });
    expect((await hook("subscription.active", { subscription_id: "sub_A" }, { id: "evt_dup" })).body.duplicate).toBe(true);
    const row = (await t.db.query<{ provider_subscription_id: string; provider_customer_id: string }>("SELECT provider_subscription_id, provider_customer_id FROM billing_subscriptions WHERE id = $1", [subId])).rows[0]!;
    expect(row).toEqual({ provider_subscription_id: "sub_A", provider_customer_id: "cus_1" });
    // renewal fails: grace keeps access; on_hold removes it; recovery restores it
    dodo.st.subs["sub_A"] = { ...live, status: "past_due" };
    await hook("subscription.past_due", { subscription_id: "sub_A" });
    expect((await t.deps.billing.check(ws, "seats")).plan).toBe("pro");
    dodo.st.subs["sub_A"] = { ...live, status: "on_hold" };
    await hook("subscription.on_hold", { subscription_id: "sub_A" });
    expect((await t.deps.billing.check(ws, "seats")).plan).toBe("free");
    dodo.st.subs["sub_A"] = { ...live, status: "active" };
    await hook("subscription.active", { subscription_id: "sub_A" });
    expect((await t.deps.billing.check(ws, "seats")).plan).toBe("pro");
    // cancelled is terminal: a late "active" webhook (provider now says cancelled) cannot resurrect it
    dodo.st.subs["sub_A"] = { ...live, status: "cancelled" };
    await hook("subscription.cancelled", { subscription_id: "sub_A" });
    await hook("subscription.active", { subscription_id: "sub_A" });
    expect((await t.deps.billing.check(ws, "seats")).plan).toBe("free");
    expect((await t.db.query<{ status: string }>("SELECT status FROM billing_subscriptions WHERE id = $1", [subId])).rows[0]!.status).toBe("canceled");
  });

  it("never grants on a product mismatch, an unknown subscription or an unmapped bind id", async () => {
    const { owner, ws } = await world(t, ["linkedin"]);
    await setRef();
    const subId = (await owner.agent.post(`/workspaces/${ws}/billing/checkout`).send({ plan: "pro", currency: "INR" })).body.data.subscriptionId as string;
    dodo.st.subs["sub_B"] = { subscription_id: "sub_B", status: "active", product_id: "pdt_CHEAP", currency: "INR", metadata: { billing_subscription_id: subId } };
    await hook("subscription.active", { subscription_id: "sub_B" });
    expect((await t.deps.billing.check(ws, "seats")).plan).toBe("free");
    dodo.st.subs["sub_C"] = { subscription_id: "sub_C", status: "active", product_id: "pdt_pro", currency: "INR", metadata: { billing_subscription_id: "00000000-0000-0000-0000-000000000000" } };
    expect((await hook("subscription.active", { subscription_id: "sub_C" })).status).toBe(200);
    expect((await t.db.query("SELECT 1 FROM billing_subscriptions WHERE provider_subscription_id IN ('sub_B','sub_C')")).rowCount).toBe(0);
    expect((await t.db.query<{ status: string }>("SELECT status FROM billing_webhook_events WHERE event_id = (SELECT event_id FROM billing_webhook_events ORDER BY received_at DESC LIMIT 1)")).rows[0]!.status).toBe("failed");   // a PAID subscription we cannot map is loud (failed + error log), never silently ignored
    expect((await t.db.query("SELECT 1 FROM billing_webhook_events WHERE status = 'failed' AND last_error LIKE '%matches no%'")).rowCount).toBeGreaterThanOrEqual(2);
  });

  it("stale checkout tab: paying plan A after starting plan B grants A (the provider's product decides), never 'paid but still free'", async () => {
    const { owner, ws } = await world(t, ["linkedin"]);
    await setRef("pro", "pdt_pro"); await setRef("starter", "pdt_starter");
    const a = (await owner.agent.post(`/workspaces/${ws}/billing/checkout`).send({ plan: "pro", currency: "INR" })).body.data.subscriptionId as string;
    await owner.agent.post(`/workspaces/${ws}/billing/checkout`).send({ plan: "starter", currency: "INR" });   // rewrites the incomplete row to starter
    dodo.st.subs["sub_S"] = { subscription_id: "sub_S", status: "active", product_id: "pdt_pro", currency: "INR", metadata: { billing_subscription_id: a } };
    await hook("subscription.active", { subscription_id: "sub_S" });
    expect((await t.deps.billing.check(ws, "seats")).plan).toBe("pro");
  });

  it("a plan change made at the provider (portal) re-maps the local plan on the next event", async () => {
    const { owner, ws } = await world(t, ["linkedin"]);
    await setRef("pro", "pdt_pro"); await setRef("starter", "pdt_starter");
    const id = (await owner.agent.post(`/workspaces/${ws}/billing/checkout`).send({ plan: "pro", currency: "INR" })).body.data.subscriptionId as string;
    dodo.st.subs["sub_P"] = { subscription_id: "sub_P", status: "active", product_id: "pdt_pro", currency: "INR", metadata: { billing_subscription_id: id } };
    await hook("subscription.active", { subscription_id: "sub_P" });
    expect((await t.deps.billing.check(ws, "seats")).plan).toBe("pro");
    dodo.st.subs["sub_P"]!["product_id"] = "pdt_starter";
    await hook("subscription.plan_changed", { subscription_id: "sub_P" });
    expect((await t.deps.billing.check(ws, "seats")).plan).toBe("starter");
  });

  it("billing managers are notified of activation, failed payment and cancellation (once each)", async () => {
    const { owner, ws } = await world(t, ["linkedin"]);
    await setRef("pro", "pdt_pro");
    const id = (await owner.agent.post(`/workspaces/${ws}/billing/checkout`).send({ plan: "pro", currency: "INR" })).body.data.subscriptionId as string;
    dodo.st.subs["sub_N"] = { subscription_id: "sub_N", status: "active", product_id: "pdt_pro", currency: "INR", metadata: { billing_subscription_id: id } };
    const types = async () => (await t.db.query<{ type: string }>("SELECT type FROM notifications WHERE workspace_id = $1 AND user_id = $2 AND type LIKE 'billing_%' ORDER BY created_at, id", [ws, owner.id])).rows.map((r) => r.type);
    await hook("subscription.active", { subscription_id: "sub_N" });
    await hook("subscription.active", { subscription_id: "sub_N" });                 // duplicate delivery: still one notification
    dodo.st.subs["sub_N"]!["status"] = "past_due";
    await hook("subscription.on_hold", { subscription_id: "sub_N" });
    dodo.st.subs["sub_N"]!["status"] = "expired";
    await hook("subscription.expired", { subscription_id: "sub_N" });
    expect(await types()).toEqual(["billing_subscription_activated", "billing_payment_failed", "billing_subscription_canceled"]);
  });

  it("daily safety-net re-sync: a cancellation whose webhook never arrived is applied by the sweep", async () => {
    const { owner, ws } = await world(t, ["linkedin"]);
    await setRef("pro", "pdt_pro");
    const id = (await owner.agent.post(`/workspaces/${ws}/billing/checkout`).send({ plan: "pro", currency: "INR" })).body.data.subscriptionId as string;
    dodo.st.subs["sub_R"] = { subscription_id: "sub_R", status: "active", product_id: "pdt_pro", currency: "INR", metadata: { billing_subscription_id: id } };
    await hook("subscription.active", { subscription_id: "sub_R" });
    expect((await t.deps.billing.check(ws, "seats")).plan).toBe("pro");
    dodo.st.subs["sub_R"]!["status"] = "expired";                                   // happened at the provider; the webhook was lost
    await t.deps.engine.billing.sweep();
    expect((await t.deps.billing.check(ws, "seats")).plan).toBe("pro");            // synced moments ago: not re-read yet
    await t.db.query("UPDATE billing_subscriptions SET synced_at = now() - interval '2 days' WHERE id = $1", [id]);
    await t.deps.engine.billing.sweep();
    expect((await t.deps.billing.check(ws, "seats")).plan).toBe("free");
  });

  it("provider outage: 200 is still returned, the event is retried by the sweeper and applied exactly once", async () => {
    const { owner, ws } = await world(t, ["linkedin"]);
    await setRef();
    const subId = (await owner.agent.post(`/workspaces/${ws}/billing/checkout`).send({ plan: "pro", currency: "INR" })).body.data.subscriptionId as string;
    dodo.st.subs["sub_D"] = { subscription_id: "sub_D", status: "active", product_id: "pdt_pro", currency: "INR", metadata: { billing_subscription_id: subId } };
    dodo.st.failGet = true;
    const r = await hook("subscription.active", { subscription_id: "sub_D" }, { id: "evt_retry" });
    expect(r.status).toBe(200);
    const ev = async () => (await t.db.query<{ status: string; last_error: string; attempts: number }>("SELECT status, last_error, attempts FROM billing_webhook_events WHERE event_id = 'evt_retry'")).rows[0]!;
    expect(await ev()).toMatchObject({ status: "failed" });
    expect((await ev()).last_error).not.toContain("secret");                          // provider body never stored
    expect((await t.deps.billing.check(ws, "seats")).plan).toBe("free");
    dodo.st.failGet = false;
    await t.db.query("DELETE FROM billing_webhook_events WHERE event_id <> 'evt_retry'");     // earlier tests leave deliberately-failed events behind
    await t.db.query("UPDATE billing_webhook_events SET next_attempt_at = now() - interval '1 second' WHERE event_id = 'evt_retry'");
    expect(await t.deps.engine.billing.sweep()).toMatchObject({ due: 1 });
    expect((await ev()).status).toBe("processed");
    expect((await t.deps.billing.check(ws, "seats")).plan).toBe("pro");
    expect(await t.deps.engine.billing.sweep()).toMatchObject({ due: 0 });
  });

  it("payments are recorded once with integer minor units; non-integer amounts are not stored as money", async () => {
    const { owner, ws } = await world(t, ["linkedin"]);
    await setRef();
    const subId = (await owner.agent.post(`/workspaces/${ws}/billing/checkout`).send({ plan: "pro", currency: "INR" })).body.data.subscriptionId as string;
    dodo.st.subs["sub_E"] = { subscription_id: "sub_E", status: "active", product_id: "pdt_pro", currency: "INR", metadata: { billing_subscription_id: subId } };
    await hook("subscription.active", { subscription_id: "sub_E" });
    await hook("payment.succeeded", { payment_id: "pay_1", subscription_id: "sub_E", total_amount: 199900, currency: "INR" }, { id: "evt_p1" });
    await hook("payment.succeeded", { payment_id: "pay_1", subscription_id: "sub_E", total_amount: 199900, currency: "INR" }, { id: "evt_p1b" });
    await hook("payment.failed", { payment_id: "pay_2", subscription_id: "sub_E", total_amount: 1999.5, currency: "INR" });
    const rows = (await t.db.query<{ provider_payment_id: string; status: string; amount_minor: string | null }>("SELECT provider_payment_id, status, amount_minor::text FROM billing_payments WHERE workspace_id = $1 ORDER BY provider_payment_id", [ws])).rows;
    expect(rows).toEqual([{ provider_payment_id: "pay_1", status: "succeeded", amount_minor: "199900" }, { provider_payment_id: "pay_2", status: "failed", amount_minor: null }]);
  });

  it("cancel: local flag changes only after the provider accepts; errors never leak credentials", async () => {
    const { owner, ws } = await world(t, ["linkedin"]);
    await setRef();
    expect((await owner.agent.post(`/workspaces/${ws}/billing/cancel`)).body.error.code).toBe("NO_ACTIVE_SUBSCRIPTION");
    const subId = (await owner.agent.post(`/workspaces/${ws}/billing/checkout`).send({ plan: "pro", currency: "INR" })).body.data.subscriptionId as string;
    dodo.st.subs["sub_F"] = { subscription_id: "sub_F", status: "active", product_id: "pdt_pro", currency: "INR", metadata: { billing_subscription_id: subId } };
    await hook("subscription.active", { subscription_id: "sub_F" });
    dodo.st.failPatch = true;
    const bad = await owner.agent.post(`/workspaces/${ws}/billing/cancel`);
    expect(bad.status).toBe(502);
    expect(JSON.stringify(bad.body)).not.toContain(API_KEY);
    expect((await owner.agent.get(`/workspaces/${ws}/billing`)).body.data.subscription.cancelAtPeriodEnd).toBe(false);
    dodo.st.failPatch = false;
    expect((await owner.agent.post(`/workspaces/${ws}/billing/cancel`)).status).toBe(200);
    expect(dodo.st.calls.find((c) => c.method === "PATCH")!.body).toEqual({ cancel_at_next_billing_date: true });
    expect((await owner.agent.get(`/workspaces/${ws}/billing`)).body.data.subscription.cancelAtPeriodEnd).toBe(true);
  });
});

describe("payments not configured", async () => {
  const t = await createTestApp([], { payments: null });
  afterAll(t.close);
  it("checkout answers 503 and the webhook answers 503 without storing anything", async () => {
    const { owner, ws } = await world(t, ["linkedin"]);
    expect((await owner.agent.post(`/workspaces/${ws}/billing/checkout`).send({ plan: "pro", currency: "INR" })).status).toBe(503);
    expect((await request(t.app).post("/webhooks/dodo").send({})).status).toBe(503);
  });
});
