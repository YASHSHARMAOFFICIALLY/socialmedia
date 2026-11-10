import { describe, it, expect, afterAll } from "vitest";
import { createHmac } from "node:crypto";
import request from "supertest";
import { checkWebhookUrl } from "../src/modules/webhooks/webhook.url.js";
import { parseSignedRequest, verifyBodySignature } from "../src/modules/webhooks/inbound.js";
import { sign } from "../src/modules/webhooks/webhook.service.js";
import { createFakeAdapter, ok } from "./helpers/fake-adapter.js";
import { createTestApp } from "./helpers/app.js";
import { drain, publish, seedAccount, world, type T, type U } from "./helpers/world.js";
import { PlatformError } from "../src/integrations/core/errors.js";

describe("webhook URL safety", () => {
  it("accepts public https URLs and rejects internal / insecure targets", () => {
    expect(checkWebhookUrl("https://hooks.example.com/in", false)).toBeNull();
    for (const bad of ["http://hooks.example.com", "https://localhost/x", "https://intranet/x", "https://10.0.0.5/x", "https://192.168.1.1", "https://169.254.169.254/latest/meta-data", "https://172.20.0.1", "https://100.64.0.1", "https://x.internal", "https://[::1]/x", "https://user:pw@example.com", "not a url", "ftp://example.com"])
      expect(checkWebhookUrl(bad, false), bad).not.toBeNull();
    expect(checkWebhookUrl("http://localhost:3000/hook", true)).toBeNull();            // allowed outside production
  });
});

describe("outbound webhooks", async () => {
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  let answer: (url: string) => Response = () => new Response("ok", { status: 200 });
  const hookFetch = (async (url: string, init: RequestInit) => { calls.push({ url, headers: Object.fromEntries(new Headers(init.headers).entries()), body: String(init.body) }); return answer(url); }) as unknown as typeof fetch;
  let result: "ok" | "fail" = "ok";
  const li = createFakeAdapter("linkedin", () => { if (result === "fail") throw new PlatformError("permanent", "nope"); return ok(); });
  const t: T = await createTestApp([li.adapter], { webhookFetch: hookFetch });
  afterAll(t.close);
  const make = async (u: U, ws: string, body: object = { url: "https://hooks.example.com/in" }) => u.agent.post(`/workspaces/${ws}/webhooks`).send(body);
  const sweep = () => t.deps.engine.webhooks.sweep();
  const forceDue = () => t.db.query("UPDATE webhook_deliveries SET next_attempt_at = now() - interval '1s' WHERE status = 'pending'");

  it("creates endpoints: secret shown once, stored encrypted, URL validated, events validated, limited to 10", async () => {
    const w = await world(t, []);
    const r = await make(w.owner, w.ws, { url: "https://hooks.example.com/in", events: ["publication.failed"] });
    expect(r.status).toBe(201);
    expect(r.body.data.secret).toMatch(/^whsec_/);
    const stored = (await t.db.query<{ secret_enc: string }>("SELECT secret_enc FROM webhook_endpoints WHERE id = $1", [r.body.data.id])).rows[0]!.secret_enc;
    expect(stored).not.toContain(r.body.data.secret);
    const list = await w.owner.agent.get(`/workspaces/${w.ws}/webhooks`);
    expect(JSON.stringify(list.body)).not.toContain("whsec_");
    expect(list.body.meta.events).toContain("publication.published");
    expect((await make(w.owner, w.ws, { url: "https://10.0.0.1/x" })).status).toBe(400);
    expect((await make(w.owner, w.ws, { url: "http://example.com/x" })).status).toBe(400);
    expect((await make(w.owner, w.ws, { url: "https://example.com/x", events: ["nope"] })).status).toBe(400);
    for (let i = 0; i < 9; i++) await make(w.owner, w.ws, { url: `https://h${i}.example.com/x` });
    expect((await make(w.owner, w.ws, { url: "https://h99.example.com/x" })).body.error.code).toBe("WEBHOOK_LIMIT");
  });

  it("delivers signed events for publication results exactly once, filtered by subscription", async () => {
    calls.length = 0; result = "fail";
    const w = await world(t, ["linkedin"], "Webhook post");
    const all = (await make(w.owner, w.ws, { url: "https://all.example.com/in", events: ["*"] })).body.data;
    const onlyOk = (await make(w.owner, w.ws, { url: "https://ok.example.com/in", events: ["publication.published"] })).body.data;
    await publish(w.owner, w.ws, w.post); await drain(t);
    await t.deps.engine.notifications.sweep();
    expect(await sweep()).toMatchObject({ due: 1, delivered: 1 });
    expect(calls).toHaveLength(1);
    const c = calls[0]!;
    expect(c.url).toBe("https://all.example.com/in");                         // the published-only endpoint was not called for a failure
    const payload = JSON.parse(c.body);
    expect(payload).toMatchObject({ type: "publication.failed", workspaceId: w.ws, data: { platform: "linkedin" } });
    const ts = Number(c.headers["x-webhook-timestamp"]);
    expect(c.headers["x-webhook-signature"]).toBe(`t=${ts},v1=${sign(all.secret, ts, c.body)}`);            // receivers can verify with the secret they were given
    expect(c.headers["x-webhook-signature"]).not.toContain(onlyOk.secret);
    await t.deps.engine.notifications.sweep(); await sweep();
    expect(calls).toHaveLength(1);                                             // idempotent per (endpoint, event)
    const log = (await w.owner.agent.get(`/workspaces/${w.ws}/webhooks/${all.id}/deliveries`)).body.data;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ event_type: "publication.failed", status: "delivered", attempts: 1, last_status: 200 });
    result = "ok";
  });

  it("retries with backoff, never follows redirects, gives up after the schedule, and disables a dead endpoint", async () => {
    const w = await world(t, []);
    const ep = (await make(w.owner, w.ws)).body.data;
    calls.length = 0;
    answer = () => new Response("down", { status: 503 });
    await w.owner.agent.post(`/workspaces/${w.ws}/webhooks/${ep.id}/ping`);
    expect(await sweep()).toMatchObject({ delivered: 0 });
    const d = (await t.db.query<{ attempts: number; s: number; status: string }>("SELECT attempts, EXTRACT(EPOCH FROM next_attempt_at - now())::float8 AS s, status FROM webhook_deliveries WHERE endpoint_id = $1", [ep.id])).rows[0]!;
    expect(d).toMatchObject({ attempts: 1, status: "pending" });
    expect(d.s).toBeGreaterThan(50); expect(d.s).toBeLessThan(70);               // first retry in ~1 minute
    expect(await sweep()).toMatchObject({ due: 0 });                              // not due yet
    answer = () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } });
    await forceDue(); await sweep();
    expect(calls.every((c) => !c.url.includes("169.254"))).toBe(true);           // redirect: manual
    for (let i = 0; i < 8; i++) { await forceDue(); await sweep(); }
    const fin = (await t.db.query<{ status: string; attempts: number; last_error: string }>("SELECT status, attempts, last_error FROM webhook_deliveries WHERE endpoint_id = $1", [ep.id])).rows[0]!;
    expect(fin).toMatchObject({ status: "failed", attempts: 8 });
    answer = () => new Response("ok", { status: 200 });
    // 410 Gone disables the endpoint immediately
    const gone = (await make(w.owner, w.ws, { url: "https://gone.example.com/in" })).body.data;
    answer = () => new Response("", { status: 410 });
    await w.owner.agent.post(`/workspaces/${w.ws}/webhooks/${gone.id}/ping`);
    await sweep();
    expect((await t.db.query("SELECT enabled, disabled_reason FROM webhook_endpoints WHERE id = $1", [gone.id])).rows[0]).toEqual({ enabled: false, disabled_reason: "receiver returned 410 Gone" });
    expect((await w.owner.agent.patch(`/workspaces/${w.ws}/webhooks/${gone.id}`).send({ enabled: true })).body.data).toMatchObject({ enabled: true, failureStreak: 0 });
    answer = () => new Response("ok", { status: 200 });
  });

  it("network failures and timeouts are retried like HTTP errors; secret rotation changes the signature key", async () => {
    const w = await world(t, []);
    const ep = (await make(w.owner, w.ws)).body.data;
    answer = () => { throw new Error("ECONNRESET"); };
    await w.owner.agent.post(`/workspaces/${w.ws}/webhooks/${ep.id}/ping`);
    await sweep();
    expect((await t.db.query<{ last_error: string; attempts: number }>("SELECT last_error, attempts FROM webhook_deliveries WHERE endpoint_id = $1", [ep.id])).rows[0]).toMatchObject({ attempts: 1, last_error: expect.stringContaining("ECONNRESET") });
    answer = () => new Response("ok", { status: 200 });
    const rot = (await w.owner.agent.post(`/workspaces/${w.ws}/webhooks/${ep.id}/rotate-secret`)).body.data;
    expect(rot.secret).not.toBe(ep.secret);
    calls.length = 0; await forceDue(); await sweep();
    const ts = Number(calls[0]!.headers["x-webhook-timestamp"]);
    expect(calls[0]!.headers["x-webhook-signature"]).toBe(`t=${ts},v1=${sign(rot.secret, ts, calls[0]!.body)}`);
  });

  it("authorization and tenant isolation", async () => {
    const w = await world(t, []);
    const ep = (await make(w.owner, w.ws)).body.data;
    const stranger = await t.newUser("s"), editor = await t.newUser("e");
    await t.db.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'editor')", [w.ws, editor.id]);
    for (const r of [await make(stranger, w.ws), await stranger.agent.get(`/workspaces/${w.ws}/webhooks`), await stranger.agent.delete(`/workspaces/${w.ws}/webhooks/${ep.id}`)]) expect(r.status).toBe(404);
    for (const r of [await make(editor, w.ws), await editor.agent.get(`/workspaces/${w.ws}/webhooks`), await editor.agent.post(`/workspaces/${w.ws}/webhooks/${ep.id}/rotate-secret`)]) expect(r.status).toBe(403);    // only owner/admin
    const other = await world(t, []);
    expect((await other.owner.agent.get(`/workspaces/${other.ws}/webhooks/${ep.id}/deliveries`)).status).toBe(404);
    expect((await w.owner.agent.delete(`/workspaces/${w.ws}/webhooks/${ep.id}`)).status).toBe(204);
  });
});

describe("inbound platform webhooks (Instagram)", async () => {
  const SECRET = "ig-app-secret-for-tests";
  const t: T = await createTestApp([], { env: { INSTAGRAM_APP_SECRET: SECRET, INSTAGRAM_WEBHOOK_VERIFY_TOKEN: "verify-token-1234567890" } });
  afterAll(t.close);
  const signed = (obj: object) => { const payload = Buffer.from(JSON.stringify(obj)).toString("base64url"); return `${createHmac("sha256", SECRET).update(payload).digest("base64url")}.${payload}`; };

  it("verification handshake echoes the challenge only with the right token", async () => {
    const ok = await request(t.app).get("/webhooks/instagram").query({ "hub.mode": "subscribe", "hub.verify_token": "verify-token-1234567890", "hub.challenge": "1158201444" });
    expect(ok.status).toBe(200);
    expect(ok.text).toBe("1158201444");
    expect((await request(t.app).get("/webhooks/instagram").query({ "hub.mode": "subscribe", "hub.verify_token": "wrong-token-0000000000", "hub.challenge": "1" })).status).toBe(403);
    expect((await request(t.app).get("/webhooks/instagram").query({ "hub.mode": "subscribe", "hub.challenge": "1" })).status).toBe(403);
  });

  it("event deliveries need a valid body signature; valid ones are stored once", async () => {
    const body = JSON.stringify({ object: "instagram", entry: [{ id: "1", time: 1, changes: [{ field: "comments", value: {} }] }] });
    const sig = `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
    const post = (s?: string) => { const r = request(t.app).post("/webhooks/instagram").set("Content-Type", "application/json"); return (s ? r.set("X-Hub-Signature-256", s) : r).send(body); };
    expect((await post()).status).toBe(401);
    expect((await post("sha256=" + "0".repeat(64))).status).toBe(401);
    expect((await post(sig.replace("sha256=", "sha1="))).status).toBe(401);
    expect((await t.db.query("SELECT 1 FROM webhook_events")).rowCount).toBe(0);               // nothing unsigned is stored
    expect((await post(sig)).body).toEqual({ received: true, duplicate: false });
    expect((await post(sig)).body).toEqual({ received: true, duplicate: true });                // platform retry
    expect((await t.db.query("SELECT 1 FROM webhook_events")).rowCount).toBe(1);
    expect(verifyBodySignature(Buffer.from(body), sig, SECRET)).toBe(true);
    expect(verifyBodySignature(Buffer.from(body + " "), sig, SECRET)).toBe(false);              // any change to the body invalidates it
  });

  it("deauthorize and data-deletion callbacks disconnect the account; deletion also purges tokens and analytics", async () => {
    const w = await world(t, []);
    const acct = await seedAccount(t, w.ws, w.owner, "instagram");
    await t.db.query("UPDATE social_accounts SET external_id = 'ig-user-777' WHERE id = $1", [acct]);
    const tgt = (await t.db.query<{ id: string }>("INSERT INTO analytics_targets (workspace_id, social_account_id, platform, scope) VALUES ($1,$2,'instagram','account') RETURNING id", [w.ws, acct])).rows[0]!.id;
    const snap = (await t.db.query<{ id: string }>("INSERT INTO analytics_snapshots (workspace_id, target_id, social_account_id, platform, scope, source, raw) VALUES ($1,$2,$3,'instagram','account','t','{}') RETURNING id", [w.ws, tgt, acct])).rows[0]!.id;
    await t.db.query("INSERT INTO analytics_metrics (snapshot_id, workspace_id, social_account_id, platform, scope, metric_key, original_name, value, availability) VALUES ($1,$2,$3,'instagram','account','followers','followers_count',5,'available')", [snap, w.ws, acct]);
    expect((await request(t.app).post("/webhooks/instagram/deauthorize").type("form").send({ signed_request: "bad.sig" })).status).toBe(400);
    expect((await request(t.app).post("/webhooks/instagram/data-deletion").type("form").send({ signed_request: signed({ user_id: "ig-user-777" }).replace(/.$/, "A") })).status).toBe(400);
    expect(parseSignedRequest(signed({ user_id: "u" }), SECRET)).toEqual({ user_id: "u" });
    expect(parseSignedRequest(signed({ user_id: "u" }), "other-secret")).toBeNull();

    const de = await request(t.app).post("/webhooks/instagram/deauthorize").type("form").send({ signed_request: signed({ user_id: "ig-user-777" }) });
    expect(de.status).toBe(200);
    expect((await t.db.query("SELECT status FROM social_accounts WHERE id = $1", [acct])).rows[0]).toEqual({ status: "disconnected" });
    expect((await t.db.query("SELECT 1 FROM oauth_credentials WHERE social_account_id = $1", [acct])).rowCount).toBe(0);
    expect((await t.db.query("SELECT 1 FROM analytics_metrics WHERE social_account_id = $1", [acct])).rowCount).toBe(1);   // deauthorize keeps history

    const del = await request(t.app).post("/webhooks/instagram/data-deletion").type("form").send({ signed_request: signed({ user_id: "ig-user-777" }) });
    expect(del.status).toBe(200);
    expect(del.body.confirmation_code).toMatch(/^[0-9a-f]{24}$/);
    expect(del.body.url).toContain(`/webhooks/data-deletion/${del.body.confirmation_code}`);
    expect((await t.db.query("SELECT 1 FROM analytics_metrics WHERE social_account_id = $1", [acct])).rowCount).toBe(0);   // data deleted
    expect((await t.db.query("SELECT display_name FROM social_accounts WHERE id = $1", [acct])).rows[0]).toEqual({ display_name: "Deleted account" });
    const status = await request(t.app).get(`/webhooks/data-deletion/${del.body.confirmation_code}`);
    expect(status.body.data).toMatchObject({ status: "completed" });
    expect((await request(t.app).get("/webhooks/data-deletion/doesnotexist")).status).toBe(404);
    expect((await t.db.query("SELECT 1 FROM audit_logs WHERE entity_id = $1 AND action = 'account.data_deleted'", [acct])).rowCount).toBe(1);
  });

  it("is inert when the platform is not configured", async () => {
    const off = await createTestApp([], {});
    expect((await request(off.app).get("/webhooks/instagram")).status).toBe(404);
    expect((await request(off.app).post("/webhooks/instagram").send({})).status).toBe(404);
    await off.close();
  });
});
