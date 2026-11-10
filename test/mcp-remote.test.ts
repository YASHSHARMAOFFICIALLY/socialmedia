import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createFakeAdapter, ok } from "./helpers/fake-adapter.js";
import { createTestApp } from "./helpers/app.js";
import { world, type T } from "./helpers/world.js";

describe("remote MCP: /mcp endpoint, tokens, device flow", async () => {
  const t = await createTestApp([createFakeAdapter("x", () => ok()).adapter]);
  afterAll(t.close);
  const upgrade = (ws: string) => t.db.query("INSERT INTO billing_subscriptions (workspace_id, plan_version_id, status, currency, interval) SELECT $1, v.id, 'active', 'INR', 'month' FROM billing_plan_versions v JOIN billing_plans p ON p.id = v.plan_id WHERE p.key = 'pro'", [ws]);
  const rpc = (token: string | null, body: object = { jsonrpc: "2.0", id: 1, method: "tools/list" }, extra: Record<string, string> = {}) => {
    const r = request(t.app).post("/mcp").set("content-type", "application/json").set("accept", "application/json, text/event-stream");
    if (token) r.set("authorization", `Bearer ${token}`);
    for (const [k, v] of Object.entries(extra)) r.set(k, v);
    return r.send(body);
  };
  const fetchVia = (token: string) => (async (url: string, init: RequestInit) => {
    const u = new URL(url);
    const r = await request(t.app).post(u.pathname).set(Object.fromEntries(new Headers(init.headers).entries())).set("authorization", `Bearer ${token}`).send(JSON.parse(String(init.body)));
    return new Response(r.text, { status: r.status, headers: r.headers as Record<string, string> });
  }) as unknown as typeof fetch;
  const pat = async (o: { agent: any }, ws: string, body: object = { name: "ci" }) => (await o.agent.post(`/workspaces/${ws}/mcp/tokens`).send(body)).body.data as { id: string; token: string; scopes: string[] };

  it("rejects missing, malformed, unknown, expired and revoked tokens with a 401 challenge that names the metadata URL", async () => {
    const { owner, ws } = await world(t, ["x"]);
    const none = await rpc(null);
    expect(none.status).toBe(401);
    expect(none.headers["www-authenticate"]).toMatch(/^Bearer resource_metadata="https?:\/\/[^"]+\/\.well-known\/oauth-protected-resource\/mcp"$/);
    expect((await rpc("garbage")).status).toBe(401);
    expect((await rpc("dsp_" + "A".repeat(43))).status).toBe(401);
    const g = await pat(owner, ws);
    expect((await rpc(g.token)).status).toBe(200);
    await t.db.query("UPDATE mcp_grants SET expires_at = now() - interval '1 second' WHERE id = $1", [g.id]);
    expect((await rpc(g.token)).status).toBe(401);
    const h = await pat(owner, ws);
    expect((await owner.agent.delete(`/workspaces/${ws}/mcp/tokens/${h.id}`)).status).toBe(204);
    expect((await rpc(h.token)).status).toBe(401);
    expect((await request(t.app).get("/.well-known/oauth-protected-resource/mcp")).body).toMatchObject({ bearer_methods_supported: ["header"] });
  });

  it("PAT: shown once, stored only as a hash, scoped, workspace-bound, owner/admin only, limited lifetime", async () => {
    const { owner, ws } = await world(t, ["x"]);
    await upgrade(ws);
    const g = await pat(owner, ws, { name: "readonly", scopes: ["billing:read"], expiresInDays: 7 });
    expect(g.token).toMatch(/^dsp_/);
    const list = (await owner.agent.get(`/workspaces/${ws}/mcp/tokens`)).body.data;
    expect(JSON.stringify(list)).not.toContain(g.token);
    expect(JSON.stringify(list)).not.toMatch(/hash/i);
    const stored = (await t.db.query<{ token_hash: string }>("SELECT token_hash FROM mcp_access_tokens")).rows.map((r) => r.token_hash);
    expect(stored).not.toContain(g.token);
    expect(JSON.stringify((await t.db.query("SELECT metadata FROM audit_logs WHERE workspace_id = $1", [ws])).rows)).not.toContain(g.token);
    const c = new Client({ name: "t", version: "1" }, { versionNegotiation: { mode: "auto" } });
    await c.connect(new StreamableHTTPClientTransport(new URL("http://test.local/mcp"), { fetch: fetchVia(g.token) }));
    const call = async (name: string) => (await c.callTool({ name, arguments: {} })).structuredContent as any;
    expect((await call("get_current_plan")).plan.key).toBe("pro");                                  // billing:read granted
    expect((await call("get_analytics_overview")).error.code).toBe("INSUFFICIENT_SCOPE");           // analytics:read not granted
    await c.close();
    expect((await owner.agent.post(`/workspaces/${ws}/mcp/tokens`).send({ name: "x", expiresInDays: 400 })).status).toBe(400);
    expect((await owner.agent.post(`/workspaces/${ws}/mcp/tokens`).send({ name: "x", scopes: ["admin:all"] })).status).toBe(400);
    const editor = await t.newUser("ed");
    await t.db.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'editor')", [ws, editor.id]);
    expect((await editor.agent.post(`/workspaces/${ws}/mcp/tokens`).send({ name: "x" })).status).toBe(403);
    expect((await editor.agent.get(`/workspaces/${ws}/mcp/tokens`)).body.data).toEqual([]);          // non-admins see only their own
    expect((await (await t.newUser("s")).agent.post(`/workspaces/${ws}/mcp/tokens`).send({ name: "x" })).status).toBe(404);
  });

  it("a removed member's token stops working immediately; a foreign Origin is refused", async () => {
    const { owner, ws } = await world(t, ["x"]);
    await upgrade(ws);
    const m = await t.newUser("m");
    await t.db.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'admin')", [ws, m.id]);
    const g = await pat(m, ws);
    const call = (token: string) => rpc(token, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_current_plan", arguments: {} } });
    expect(JSON.stringify((await call(g.token)).text)).toContain("pro");
    await t.db.query("DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2", [ws, m.id]);
    expect((await call(g.token)).text).toContain("NOT_FOUND");
    expect((await rpc(g.token, undefined, { origin: "https://evil.example" })).status).toBe(403);
    void owner;
  });

  it("device flow: pending -> approve in a browser session -> tokens; refresh rotates; reuse of an old refresh token revokes the grant", async () => {
    const { owner, ws } = await world(t, ["x"]);
    await upgrade(ws);
    const start = (await request(t.app).post("/mcp/device").send({ client_name: "distora-cli", scopes: ["analytics:read", "billing:read"] })).body;
    expect(start.user_code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(start.verification_uri_complete).toContain(start.user_code);
    const poll = (code = start.device_code) => request(t.app).post("/mcp/token").type("form").send({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: code });
    expect((await poll()).body.error).toBe("authorization_pending");
    expect((await poll()).body.error).toBe("slow_down");                                              // polled again within the interval
    expect((await request(t.app).get("/mcp/device")).status).toBe(401);                                // approval page needs a signed-in browser
    const page = await owner.agent.get(`/mcp/device?user_code=${start.user_code}`);
    expect(page.text).toContain("distora-cli");
    expect(page.text).toContain(ws);
    const stranger = await t.newUser("st");
    expect((await stranger.agent.post("/mcp/device/approve").type("form").send({ user_code: start.user_code, workspace_id: ws, decision: "approve" })).status).toBe(404);   // cannot approve into a workspace they are not in
    expect((await owner.agent.post("/mcp/device/approve").type("form").send({ user_code: start.user_code, workspace_id: ws, decision: "approve" })).status).toBe(200);
    await t.db.query("UPDATE mcp_device_codes SET last_polled_at = now() - interval '1 minute'");
    const tok = (await poll()).body;
    expect(tok).toMatchObject({ token_type: "Bearer", expires_in: 3600, workspace_id: ws });
    expect((await poll()).body.error).toBe("invalid_grant");                                           // single use
    expect((await rpc(tok.access_token)).status).toBe(200);
    const refresh = (rt: string) => request(t.app).post("/mcp/token").type("form").send({ grant_type: "refresh_token", refresh_token: rt });
    const r1 = (await refresh(tok.refresh_token)).body;
    expect(r1.refresh_token).not.toBe(tok.refresh_token);
    expect((await rpc(r1.access_token)).status).toBe(200);
    const replay = await refresh(tok.refresh_token);                                                   // the OLD refresh token again = theft signal
    expect(replay.status).toBe(400);
    expect(replay.body.error).toBe("invalid_grant");
    expect((await rpc(r1.access_token)).status).toBe(401);                                             // whole grant is dead
    expect((await refresh(r1.refresh_token)).status).toBe(400);
    expect((await t.db.query("SELECT 1 FROM audit_logs WHERE action = 'mcp.grant.reuse_detected'")).rowCount).toBe(1);
  });

  it("device flow: deny, expiry, unknown scope and unknown codes", async () => {
    const { owner, ws } = await world(t, ["x"]);
    const d = (await request(t.app).post("/mcp/device").send({ client_name: "c" })).body;
    await owner.agent.post("/mcp/device/approve").type("form").send({ user_code: d.user_code, workspace_id: ws, decision: "deny" });
    const poll = (code: string) => request(t.app).post("/mcp/token").type("form").send({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: code });
    expect((await poll(d.device_code)).body.error).toBe("access_denied");
    const e = (await request(t.app).post("/mcp/device").send({})).body;
    await t.db.query("UPDATE mcp_device_codes SET expires_at = now() - interval '1 second' WHERE user_code = $1", [e.user_code]);
    expect((await poll(e.device_code)).body.error).toBe("expired_token");
    expect((await owner.agent.post("/mcp/device/approve").type("form").send({ user_code: e.user_code, workspace_id: ws, decision: "approve" })).status).toBe(404);
    expect((await poll("dsd_nope")).body.error).toBe("invalid_grant");
    expect((await request(t.app).post("/mcp/device").send({ scopes: ["root"] })).status).toBe(400);
    expect((await request(t.app).post("/mcp/token").type("form").send({ grant_type: "password" })).body.error).toBe("UNSUPPORTED_GRANT_TYPE".toLowerCase());
  });
});
