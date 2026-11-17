import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { createBlueskyAdapter } from "../src/integrations/bluesky/bluesky.adapter.js";
import { createFacebookAdapter } from "../src/integrations/facebook/facebook.adapter.js";
import { createCipher } from "../src/infrastructure/encryption/cipher.js";
import { createTestApp, TEST_KEYS } from "./helpers/app.js";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const exp = Math.floor(Date.now() / 1000) + 7200;
const jwt = `x.${btoa(JSON.stringify({ exp })).replace(/=/g, "")}.y`;
let sessionOk = true, platformDown = false;
const fakeBsky = (async (url: string | URL | Request) => {
  const u = String(url);
  if (u.includes("createSession") && platformDown) return json({ error: "Unavailable" }, 503);
  if (u.includes("createSession")) return sessionOk ? json({ accessJwt: jwt, refreshJwt: "REFRESH-SECRET", handle: "ada.bsky.social", did: "did:plc:ada" }) : json({ error: "AuthenticationRequired" }, 401);
  if (u.includes("getProfile")) return json({ displayName: "Ada" });
  return json({}, 404);
}) as typeof fetch;
const fakeFb = (async (url: string | URL | Request) => {
  const u = String(url);
  if (u.includes("oauth/access_token")) return json({ access_token: "USER-TOKEN" });
  if (u.includes("/me?")) return json({ id: "fb-user-1" });
  if (u.includes("/me/accounts")) return json({ data: [{ id: "p1", name: "Page One", access_token: "PAGE-TOKEN-1" }, { id: "p2", name: "Page Two", access_token: "PAGE-TOKEN-2" }] });
  return json({}, 404);
}) as typeof fetch;

describe("credentials-mode and multi-account connect", async () => {
  const t = await createTestApp([createBlueskyAdapter({}, fakeBsky), createFacebookAdapter({ clientId: "c", clientSecret: "s" }, fakeFb)]);
  afterAll(t.close);
  const setup = async () => {
    const owner = await t.newUser("owner");
    const ws = (await owner.agent.post("/workspaces").send({ name: "W" })).body.data.id as string;
    return { owner, ws };
  };

  it("/platforms exposes connect mode and credential fields (never values)", async () => {
    const { owner } = await setup();
    const list = (await owner.agent.get("/platforms")).body.data as { platform: string; connect: string | null; fields?: { name: string; secret: boolean }[] }[];
    expect(list.find((p) => p.platform === "bluesky")).toMatchObject({ connect: "credentials", fields: [{ name: "identifier" }, { name: "appPassword", secret: true }] });
    expect(list.find((p) => p.platform === "facebook")?.connect).toBe("oauth");
    expect(list.find((p) => p.platform === "telegram")?.connect).toBeNull(); // not registered in this test app
  });

  it("connect-credentials stores encrypted tokens, returns none, and audits", async () => {
    const { owner, ws } = await setup();
    const r = await owner.agent.post(`/workspaces/${ws}/accounts/connect-credentials`).send({ platform: "bluesky", fields: { identifier: "ada.bsky.social", appPassword: "app-password-secret" } });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ platform: "bluesky", external_id: "did:plc:ada", display_name: "Ada", status: "active" });
    expect(JSON.stringify(r.body)).not.toMatch(/app-password-secret|REFRESH-SECRET|_enc|accessJwt/);
    const row = (await t.db.query<{ access_token_enc: string; refresh_token_enc: string }>("SELECT access_token_enc, refresh_token_enc FROM oauth_credentials WHERE social_account_id = $1", [r.body.data.id])).rows[0]!;
    const cipher = await createCipher(TEST_KEYS);
    expect(await cipher.decrypt(row.refresh_token_enc, `cred:${r.body.data.id}`)).toBe("REFRESH-SECRET");
    expect(JSON.stringify(row)).not.toContain("app-password-secret"); // the app password itself is never stored
    expect((await t.db.query("SELECT 1 FROM audit_logs WHERE action = 'account.connected' AND entity_id = $1", [r.body.data.id])).rows).toHaveLength(1);
  });

  it("rejects missing fields, OAuth platforms, bad credentials, and non-managers", async () => {
    const { owner, ws } = await setup();
    const post = (body: unknown) => owner.agent.post(`/workspaces/${ws}/accounts/connect-credentials`).send(body as object);
    expect((await post({ platform: "bluesky", fields: { identifier: "x" } })).status).toBe(400);
    expect((await post({ platform: "facebook", fields: {} })).status).toBe(400);
    sessionOk = false;
    const bad = await post({ platform: "bluesky", fields: { identifier: "x", appPassword: "y" } });
    expect(bad.status).toBe(400);                                  // a typo'd app password is the user's to fix, never a 500
    expect(bad.body.error.message).toMatch(/rejected/i);
    sessionOk = true; platformDown = true;
    expect((await post({ platform: "bluesky", fields: { identifier: "x", appPassword: "y" } })).status).toBe(502);   // platform outage: retry later
    platformDown = false;
    const outsider = await t.newUser("outsider");
    expect((await outsider.agent.post(`/workspaces/${ws}/accounts/connect-credentials`).send({ platform: "bluesky", fields: { identifier: "a", appPassword: "b" } })).status).toBe(404); // non-members cannot even learn the workspace exists
  });

  it("one Facebook authorization connects every Page with its own encrypted Page token", async () => {
    const { owner, ws } = await setup();
    const start = await owner.agent.post(`/workspaces/${ws}/accounts/connect`).send({ platform: "facebook" });
    const state = new URL(start.body.data.authorizationUrl).searchParams.get("state")!;
    const cb = await owner.agent.get(`/oauth/facebook/callback?code=C&state=${state}`);
    expect(cb.status).toBe(302);
    const list = (await owner.agent.get(`/workspaces/${ws}/accounts`)).body.data as { id: string; external_id: string }[];
    expect(list.map((a) => a.external_id).sort()).toEqual(["p1", "p2"]);
    const cipher = await createCipher(TEST_KEYS);
    for (const a of list) {
      const row = (await t.db.query<{ access_token_enc: string }>("SELECT access_token_enc FROM oauth_credentials WHERE social_account_id = $1", [a.id])).rows[0]!;
      expect(await cipher.decrypt(row.access_token_enc, `cred:${a.id}`)).toBe(a.external_id === "p1" ? "PAGE-TOKEN-1" : "PAGE-TOKEN-2");
    }
  });

  it("reconnecting one Page keeps only that Page", async () => {
    const { owner, ws } = await setup();
    const connect = async (reconnect?: string) => {
      const url = reconnect ? (await owner.agent.post(`/workspaces/${ws}/accounts/${reconnect}/refresh`)).body.data.authorizationUrl : (await owner.agent.post(`/workspaces/${ws}/accounts/connect`).send({ platform: "facebook" })).body.data.authorizationUrl;
      return owner.agent.get(`/oauth/facebook/callback?code=C&state=${new URL(url).searchParams.get("state")}`);
    };
    await connect();
    const first = ((await owner.agent.get(`/workspaces/${ws}/accounts`)).body.data as { id: string; external_id: string }[]).find((a) => a.external_id === "p1")!;
    await t.db.query("UPDATE social_accounts SET status = 'needs_reauth' WHERE id = $1", [first.id]);
    await t.db.query("DELETE FROM social_accounts WHERE workspace_id = $1 AND external_id = 'p2'", [ws]);
    expect((await connect(first.id)).status).toBe(302);
    const after = (await owner.agent.get(`/workspaces/${ws}/accounts`)).body.data as { external_id: string; status: string }[];
    expect(after.map((a) => a.external_id)).toEqual(["p1"]); // p2 was NOT re-created by the reconnect
    expect(after[0]!.status).toBe("active");
  });
});
