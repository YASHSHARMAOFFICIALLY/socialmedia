import { describe, it, expect, afterAll } from "vitest";
import { createHash } from "node:crypto";
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

  it("per-token rate limit answers 429 with Retry-After (not 200), and does not affect other tokens", async () => {
    const { owner, ws } = await world(t, ["x"]);
    const a = await pat(owner, ws), b = await pat(owner, ws);
    let last = 200;
    for (let i = 0; i < 125 && last === 200; i++) last = (await rpc(a.token)).status;
    expect(last).toBe(429);
    const again = await rpc(a.token);
    expect(again.status).toBe(429);
    expect(again.headers["retry-after"]).toBeDefined();
    expect((await rpc(b.token)).status).toBe(200);
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

  it("consent/approval pages let browsers send their real Origin: no-referrer would make Chrome post `Origin: null` and the CSRF guard would reject every click", async () => {
    const { owner } = await world(t, ["x"]);
    const start = (await request(t.app).post("/mcp/device").send({ client_name: "postrally-cli" })).body;
    const page = await owner.agent.get(`/mcp/device?user_code=${start.user_code}`);
    expect(page.headers["referrer-policy"]).toBe("same-origin");
    expect((await request(t.app).get("/health/live")).headers["referrer-policy"]).toBe("same-origin");
    // what Chrome sends with that policy for a same-origin form post: the page's own origin, which the guard accepts; the literal "null" is never accepted
    const own = new URL(start.verification_uri).origin;
    expect((await owner.agent.post("/mcp/device/approve").set("Origin", "null").type("form").send({ user_code: start.user_code, decision: "deny" })).status).toBe(403);
    expect((await owner.agent.post("/mcp/device/approve").set("Origin", own).type("form").send({ user_code: start.user_code, decision: "deny" })).status).not.toBe(403);
  });

  it("device flow: pending -> approve in a browser session -> tokens; refresh rotates; reuse of an old refresh token revokes the grant", async () => {
    const { owner, ws } = await world(t, ["x"]);
    await upgrade(ws);
    const start = (await request(t.app).post("/mcp/device").send({ client_name: "postrally-cli", scopes: ["analytics:read", "billing:read"] })).body;
    expect(start.user_code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(start.verification_uri_complete).toContain(start.user_code);
    const poll = (code = start.device_code) => request(t.app).post("/mcp/token").type("form").send({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: code });
    expect((await poll()).body.error).toBe("authorization_pending");
    expect((await poll()).body.error).toBe("slow_down");                                              // polled again within the interval
    expect((await request(t.app).get("/mcp/device")).status).toBe(401);                                // approval page needs a signed-in browser
    const page = await owner.agent.get(`/mcp/device?user_code=${start.user_code}`);
    expect(page.text).toContain("postrally-cli");
    expect(page.text).toContain(ws);
    const stranger = await t.newUser("st");
    const viewer = await t.newUser("vw");
    await t.db.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'viewer')", [ws, viewer.id]);
    expect((await viewer.agent.post("/mcp/device/approve").type("form").send({ user_code: start.user_code, workspace_id: ws, decision: "approve" })).status).toBe(403);   // mcp:manage, like PATs
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
    const race = await refresh(tok.refresh_token);                                                     // a concurrent client replaying the just-rotated token: refused, grant kept
    expect(race.body.error).toBe("invalid_grant");
    expect((await rpc(r1.access_token)).status).toBe(200);
    const r2 = (await refresh(r1.refresh_token)).body;                                                 // rotate twice, as a thief would
    await t.db.query("UPDATE mcp_grants SET rotated_at = now() - interval '10 minutes'");
    const replay = await refresh(tok.refresh_token);                                                   // the FIRST token again, two rotations later = theft signal
    expect(replay.status).toBe(400);
    expect(replay.body.error).toBe("invalid_grant");
    expect((await rpc(r2.access_token)).status).toBe(401);                                             // whole grant is dead
    expect((await refresh(r2.refresh_token)).status).toBe(400);
    expect((await t.db.query("SELECT 1 FROM audit_logs WHERE action = 'mcp.grant.reuse_detected'")).rowCount).toBe(1);
  });

  describe("browser OAuth: authorization code + PKCE + dynamic client registration", () => {
    const verifier = "v".repeat(60), challenge = createHash("sha256").update(verifier).digest("base64url");
    const REDIRECT = "https://claude.example/api/mcp/auth_callback";
    const register = (body: object = { client_name: "Claude", redirect_uris: [REDIRECT] }) => request(t.app).post("/mcp/register").send(body);
    const q = (clientId: string, extra: Record<string, string> = {}) => new URLSearchParams({ client_id: clientId, redirect_uri: REDIRECT, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", state: "xyz", ...extra });
    const approve = (u: { agent: any }, clientId: string, ws: string, decision = "approve", extra: Record<string, string> = {}) =>
      u.agent.post("/mcp/authorize").type("form").send({ ...Object.fromEntries(q(clientId, extra)), workspace_id: ws, decision });
    const codeFrom = (html: string) => new URL(/href="([^"]+)"/.exec(html)![1]!.replace(/&amp;/g, "&").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))));
    const exchange = (code: string, clientId: string, v = verifier, redirect = REDIRECT) => request(t.app).post("/mcp/token").type("form").send({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: redirect, code_verifier: v });

    it("metadata advertises the flow; registration accepts safe redirect URIs only", async () => {
      const md = (await request(t.app).get("/.well-known/oauth-authorization-server")).body;
      expect(md).toMatchObject({ code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"] });
      expect(md.registration_endpoint).toMatch(/\/mcp\/register$/);
      expect((await request(t.app).get("/.well-known/oauth-protected-resource/mcp")).body.authorization_servers).toHaveLength(1);
      const ok = await register();
      expect(ok.status).toBe(201);
      expect(ok.body.client_id).toMatch(/^dsc_/);
      for (const bad of ["javascript:alert(1)", "http://evil.test/cb", "file:///etc/passwd", "https://u:p@x.test/cb", "https://x.test/cb#f", "notaurl"]) expect((await register({ client_name: "x", redirect_uris: [bad] })).status, bad).toBe(400);
      expect((await register({ client_name: "Local", redirect_uris: ["http://127.0.0.1:8123/cb", "cursor://anysphere.cursor/mcp"] })).status).toBe(201);
    });

    it("full flow: consent -> code -> token (PKCE) -> /mcp works -> refresh rotates; code is single-use", async () => {
      const { owner, ws } = await world(t, ["x"]);
      await upgrade(ws);
      const { client_id } = (await register()).body;
      const page = await owner.agent.get(`/mcp/authorize?${q(client_id)}`);
      expect(page.status).toBe(200);
      expect(page.text).toContain("Claude");
      expect((await request(t.app).get(`/mcp/authorize?${q(client_id)}`)).status).toBe(302);                 // not signed in: sent to the app login
      const done = await approve(owner, client_id, ws);
      expect(done.status).toBe(200);
      const back = codeFrom(done.text);
      expect(back.origin + back.pathname).toBe(REDIRECT);
      expect(back.searchParams.get("state")).toBe("xyz");
      const code = back.searchParams.get("code")!;
      expect((await exchange(code, client_id, "w".repeat(60))).status).toBe(400);                            // wrong verifier burns the code
      expect((await exchange(code, client_id)).status).toBe(400);
      const code2 = codeFrom((await approve(owner, client_id, ws)).text).searchParams.get("code")!;
      expect((await exchange(code2, client_id, verifier, "https://claude.example/other")).status).toBe(400);   // redirect_uri must match
      const code3 = codeFrom((await approve(owner, client_id, ws)).text).searchParams.get("code")!;
      const tok = await exchange(code3, client_id);
      expect(tok.status).toBe(200);
      expect(tok.body).toMatchObject({ token_type: "Bearer", workspace_id: ws });
      expect(tok.body.scope).not.toContain("billing:portal");                                                 // least privilege by default
      expect((await rpc(tok.body.access_token)).status).toBe(200);
      expect((await exchange(code3, client_id)).status).toBe(400);                                            // replay
      const r1 = await request(t.app).post("/mcp/token").type("form").send({ grant_type: "refresh_token", refresh_token: tok.body.refresh_token });
      expect(r1.status).toBe(200);
      expect((await t.db.query("SELECT 1 FROM mcp_grants WHERE kind = 'oauth'")).rowCount).toBeGreaterThanOrEqual(1);
    });

    it("rejects unknown clients, unregistered redirects, missing PKCE, non-admins, cross-site posts; deny returns access_denied", async () => {
      const { owner, ws } = await world(t, ["x"]);
      const { client_id } = (await register()).body;
      expect((await owner.agent.get(`/mcp/authorize?${q("dsc_unknown")}`)).status).toBe(400);
      expect((await owner.agent.get(`/mcp/authorize?${q(client_id, { redirect_uri: "https://evil.test/cb" })}`)).status).toBe(400);
      expect((await owner.agent.get(`/mcp/authorize?${q(client_id, { code_challenge_method: "plain" })}`)).status).toBe(400);
      const noPkce = q(client_id); noPkce.delete("code_challenge");
      expect((await owner.agent.get(`/mcp/authorize?${noPkce}`)).status).toBe(400);
      const viewer = await t.newUser("vw2");
      await t.db.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'viewer')", [ws, viewer.id]);
      expect((await approve(viewer, client_id, ws)).status).toBe(403);
      const cross = await owner.agent.post("/mcp/authorize").set("origin", "https://evil.test").type("form").send({ ...Object.fromEntries(q(client_id)), workspace_id: ws, decision: "approve" });
      expect(cross.status).toBe(403);
      const denied = codeFrom((await approve(owner, client_id, ws, "deny")).text);
      expect(denied.searchParams.get("error")).toBe("access_denied");
      expect(denied.searchParams.get("code")).toBeNull();
    });
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
