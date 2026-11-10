import { describe, it, expect, afterAll } from "vitest";
import { createLinkedInAdapter } from "../src/integrations/linkedin/linkedin.adapter.js";
import { createCipher } from "../src/infrastructure/encryption/cipher.js";
import { createTestApp, TEST_KEYS } from "./helpers/app.js";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
let sub = "li-user-1";
let tokenResponse: Record<string, unknown> = { access_token: "LI-ACCESS-SECRET", expires_in: 5184000, scope: "openid,profile,email,w_member_social" };
const fakeLinkedIn = (async (url: string | URL | Request) => {
  const u = String(url);
  if (u.includes("/oauth/v2/accessToken")) return json(tokenResponse);
  if (u.includes("/v2/userinfo")) return json({ sub, name: "Test Member" });
  return json({}, 404);
}) as typeof fetch;

describe("social accounts + OAuth", async () => {
  const t = await createTestApp([createLinkedInAdapter({ clientId: "cid", clientSecret: "sec" }, fakeLinkedIn)]);
  afterAll(t.close);
  const setup = async () => {
    const owner = await t.newUser("owner");
    const ws = (await owner.agent.post("/workspaces").send({ name: "W" })).body.data.id as string;
    return { owner, ws };
  };
  const startOAuth = async (u: Awaited<ReturnType<typeof t.newUser>>, ws: string) => {
    const r = await u.agent.post(`/workspaces/${ws}/accounts/connect`).send({ platform: "linkedin" });
    expect(r.status).toBe(200);
    return new URL(r.body.data.authorizationUrl).searchParams.get("state")!;
  };
  const cb = (state: string, extra = "code=AUTHCODE") => t.deps && import("supertest").then((m) => m.default(t.app).get(`/oauth/linkedin/callback?${extra}&state=${state}`));

  it("connect → callback stores an encrypted credential and returns no tokens", async () => {
    const { owner, ws } = await setup();
    const state = await startOAuth(owner, ws);
    const res = (await cb(state))!;
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/accounts\?connected=/);

    const list = await owner.agent.get(`/workspaces/${ws}/accounts`);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ platform: "linkedin", display_name: "Test Member", status: "active" });
    const detail = await owner.agent.get(`/workspaces/${ws}/accounts/${list.body.data[0].id}`);
    expect(JSON.stringify([list.body, detail.body])).not.toMatch(/LI-ACCESS-SECRET|access_token|refresh_token|_enc/);
    expect(detail.body.data.permissions.find((p: { permission: string }) => p.permission === "w_member_social").granted).toBe(true);

    const row = (await t.db.query<{ access_token_enc: string }>("SELECT access_token_enc FROM oauth_credentials")).rows.at(-1)!;
    expect(row.access_token_enc).not.toContain("LI-ACCESS-SECRET");
    const cipher = await createCipher(TEST_KEYS);
    expect(await cipher.decrypt(row.access_token_enc, `cred:${list.body.data[0].id}`)).toBe("LI-ACCESS-SECRET");
    await expect(cipher.decrypt(row.access_token_enc, "cred:other-account")).rejects.toThrow(); // bound to its row
  });

  it("state is single-use, validated, and expires", async () => {
    const { owner, ws } = await setup();
    sub = "li-user-2";
    const state = await startOAuth(owner, ws);
    expect((await cb(state))!.status).toBe(302);
    expect((await cb(state))!.status).toBe(400); // replay
    expect((await cb("totally-forged-state-value"))!.status).toBe(400);
    expect((await cb("short"))!.status).toBe(400);
    const expired = await startOAuth(owner, ws);
    await t.db.query("UPDATE oauth_states SET expires_at = now() - interval '1 minute' WHERE used_at IS NULL");
    expect((await cb(expired))!.status).toBe(400);
  });

  it("user-denied authorization consumes state and connects nothing", async () => {
    const { owner, ws } = await setup();
    const state = await startOAuth(owner, ws);
    const res = (await cb(state, "error=user_cancelled_authorize"))!;
    expect(res.status).toBe(400);
    expect((await owner.agent.get(`/workspaces/${ws}/accounts`)).body.data).toHaveLength(0);
    expect((await cb(state))!.status).toBe(400);
  });

  it("state is bound to the workspace: losing manage permission before the callback blocks connection", async () => {
    const { owner, ws } = await setup();
    sub = "li-user-3";
    const state = await startOAuth(owner, ws);
    const other = await t.newUser("other");
    await t.db.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'owner')", [ws, other.id]); // so owner can leave
    await owner.agent.delete(`/workspaces/${ws}/members/${owner.id}`);
    expect((await cb(state))!.status).toBe(404);
    expect((await t.db.query("SELECT 1 FROM social_accounts WHERE workspace_id = $1", [ws])).rowCount).toBe(0);
  });

  it("RBAC + isolation", async () => {
    const { owner, ws } = await setup();
    const viewer = await t.newUser("viewer");
    await t.db.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'viewer')", [ws, viewer.id]);
    expect((await viewer.agent.post(`/workspaces/${ws}/accounts/connect`).send({ platform: "linkedin" })).status).toBe(403);
    expect((await viewer.agent.get(`/workspaces/${ws}/accounts`)).status).toBe(200);
    const stranger = await t.newUser("stranger");
    expect((await stranger.agent.get(`/workspaces/${ws}/accounts`)).status).toBe(404);
    expect((await stranger.agent.post(`/workspaces/${ws}/accounts/connect`).send({ platform: "linkedin" })).status).toBe(404);
    // an account from workspace A is invisible through workspace B's URL
    sub = "li-user-4";
    await cb(await startOAuth(owner, ws));
    const acctId = (await owner.agent.get(`/workspaces/${ws}/accounts`)).body.data[0].id;
    const ws2 = (await owner.agent.post("/workspaces").send({ name: "W2" })).body.data.id;
    expect((await owner.agent.get(`/workspaces/${ws2}/accounts/${acctId}`)).status).toBe(404);
    expect((await owner.agent.delete(`/workspaces/${ws2}/accounts/${acctId}`)).status).toBe(404);
  });

  it("unavailable platforms are rejected and reported", async () => {
    const { owner, ws } = await setup();
    const r = await owner.agent.post(`/workspaces/${ws}/accounts/connect`).send({ platform: "x" });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("PLATFORM_UNAVAILABLE");
    const p = (await owner.agent.get("/platforms")).body.data;
    expect(p.find((x: { platform: string }) => x.platform === "linkedin").available).toBe(true);
    expect(p.find((x: { platform: string }) => x.platform === "youtube")).toMatchObject({ available: false, capabilities: null });
  });

  it("disconnect deletes credentials; reconnect reuses the same account row", async () => {
    const { owner, ws } = await setup();
    sub = "li-user-5";
    await cb(await startOAuth(owner, ws));
    const id = (await owner.agent.get(`/workspaces/${ws}/accounts`)).body.data[0].id;
    expect((await owner.agent.delete(`/workspaces/${ws}/accounts/${id}`)).status).toBe(204);
    expect((await t.db.query("SELECT 1 FROM oauth_credentials WHERE social_account_id = $1", [id])).rowCount).toBe(0);
    expect((await owner.agent.get(`/workspaces/${ws}/accounts`)).body.data).toHaveLength(0);
    await cb(await startOAuth(owner, ws));
    const again = (await owner.agent.get(`/workspaces/${ws}/accounts`)).body.data;
    expect(again).toHaveLength(1);
    expect(again[0].id).toBe(id);
  });

  it("expired token without refresh → needs_reauth + auth_expired; refresh endpoint offers re-authorization", async () => {
    const { owner, ws } = await setup();
    sub = "li-user-6";
    await cb(await startOAuth(owner, ws));
    const id = (await owner.agent.get(`/workspaces/${ws}/accounts`)).body.data[0].id;
    expect(await t.deps.accounts.getAccessToken(ws, id)).toBe("LI-ACCESS-SECRET");
    await t.db.query("UPDATE oauth_credentials SET expires_at = now() - interval '1 hour' WHERE social_account_id = $1", [id]);
    await expect(t.deps.accounts.getAccessToken(ws, id)).rejects.toMatchObject({ kind: "auth_expired" });
    expect((await owner.agent.get(`/workspaces/${ws}/accounts/${id}`)).body.data.status).toBe("needs_reauth");
    const r = await owner.agent.post(`/workspaces/${ws}/accounts/${id}/refresh`);
    expect(r.body.data.status).toBe("reauthorization_required");
    const state = new URL(r.body.data.authorizationUrl).searchParams.get("state")!;
    expect((await cb(state))!.status).toBe(302); // re-consent reactivates the same account
    expect((await owner.agent.get(`/workspaces/${ws}/accounts/${id}`)).body.data.status).toBe("active");
  });

  it("refreshes near-expiry tokens when a refresh token exists, persisting the rotated ones", async () => {
    const { owner, ws } = await setup();
    sub = "li-user-7";
    tokenResponse = { access_token: "A1", refresh_token: "R1", expires_in: 3600, refresh_token_expires_in: 99999, scope: "openid" };
    await cb(await startOAuth(owner, ws));
    const id = (await owner.agent.get(`/workspaces/${ws}/accounts`)).body.data[0].id;
    tokenResponse = { access_token: "A2", refresh_token: "R2", expires_in: 3600, scope: "openid" };
    await t.db.query("UPDATE oauth_credentials SET expires_at = now() + interval '1 minute' WHERE social_account_id = $1", [id]);
    expect(await t.deps.accounts.getAccessToken(ws, id)).toBe("A2");
    expect(await t.deps.accounts.getAccessToken(ws, id)).toBe("A2"); // fresh now: no second refresh
    tokenResponse = { access_token: "LI-ACCESS-SECRET", expires_in: 5184000, scope: "openid" };
  });
});
