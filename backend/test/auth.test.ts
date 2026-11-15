import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { createTestApp, ORIGIN } from "./helpers/app.js";

describe("authentication", async () => {
  const t = await createTestApp();
  afterAll(t.close);

  it("rejects unauthenticated access to protected routes", async () => {
    const r = await request(t.app).get("/workspaces");
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe("UNAUTHORIZED");
  });
  it("registers, then the session authenticates API calls", async () => {
    const u = await t.newUser("reg");
    expect((await u.agent.get("/workspaces")).status).toBe(200);
  });
  it("rejects weak passwords and duplicate emails", async () => {
    const weak = await request(t.app).post("/api/auth/sign-up/email").set("Origin", ORIGIN).send({ name: "w", email: "weak@example.com", password: "short" });
    expect(weak.status).toBe(400);
    const u = await t.newUser("dup");
    const dup = await request(t.app).post("/api/auth/sign-up/email").set("Origin", ORIGIN).send({ name: "d", email: u.email, password: "correct-horse-battery" });
    expect(dup.status).toBeGreaterThanOrEqual(400);
  });
  it("login works, wrong password fails, logout invalidates session", async () => {
    const u = await t.newUser("login");
    const bad = await request(t.app).post("/api/auth/sign-in/email").set("Origin", ORIGIN).send({ email: u.email, password: "wrong-password-123" });
    expect(bad.status).toBe(401);
    const agent = request.agent(t.app);
    const ok = await agent.post("/api/auth/sign-in/email").set("Origin", ORIGIN).send({ email: u.email, password: "correct-horse-battery" });
    expect(ok.status).toBe(200);
    expect((await agent.get("/workspaces")).status).toBe(200);
    expect((await agent.post("/api/auth/sign-out").set("Origin", ORIGIN).send({})).status).toBe(200);
    expect((await agent.get("/workspaces")).status).toBe(401);
  });
  it("never returns credentials in auth responses", async () => {
    const u = await t.newUser("leak");
    const s = await u.agent.get("/api/auth/get-session");
    expect(JSON.stringify(s.body)).not.toMatch(/password|correct-horse/);
  });
});

describe("email verification", async () => {
  const on = await createTestApp([], { env: { REQUIRE_EMAIL_VERIFICATION: "true" } });
  afterAll(on.close);
  const off = await createTestApp();
  afterAll(off.close);

  it("a verification mail is always sent on sign-up; when required, sign-in is refused until the link is used", async () => {
    const email = "verify1@example.com";
    const su = await request(on.app).post("/api/auth/sign-up/email").set("Origin", ORIGIN).send({ name: "v", email, password: "correct-horse-battery" });
    expect(su.status).toBe(200);
    const mail = on.sent.find((m) => m.to === email && /Verify/.test(m.subject));
    expect(mail).toBeDefined();
    const login = () => request(on.app).post("/api/auth/sign-in/email").set("Origin", ORIGIN).send({ email, password: "correct-horse-battery" });
    expect((await login()).status).toBe(403);
    const link = /href="([^"]+)"/.exec(mail!.html)![1]!.replace(/&amp;/g, "&");
    const u = new URL(link);
    expect((await request(on.app).get(u.pathname + u.search).set("Origin", ORIGIN)).status).toBeLessThan(400);
    expect((await login()).status).toBe(200);
  });

  it("not required by default: users can sign in straight away", async () => {
    await off.newUser("noverify");
  });
});

describe("account erasure (DELETE /me)", async () => {
  const t = await createTestApp();
  afterAll(t.close);
  const login = (email: string) => request(t.app).post("/api/auth/sign-in/email").set("Origin", ORIGIN).send({ email, password: "correct-horse-battery" });

  it("refuses while the user is the only owner of a workspace; then anonymizes, ends sessions and logins, and keeps the workspace content", async () => {
    const u = await t.newUser("erase");
    const ws = (await u.agent.post("/workspaces").send({ name: "Mine" })).body.data.id as string;
    expect((await u.agent.delete("/me").send({ confirmEmail: "someone@else.com" })).status).toBe(400);
    const stuck = await u.agent.delete("/me").send({ confirmEmail: u.email });
    expect(stuck.status).toBe(409);
    expect(stuck.body.error.code).toBe("OWNS_WORKSPACES");
    const heir = await t.newUser("heir");
    await t.db.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'admin')", [ws, heir.id]);
    expect((await u.agent.patch(`/workspaces/${ws}/members/${heir.id}`).send({ role: "owner" })).status).toBe(200);   // hand it over
    await u.agent.post(`/workspaces/${ws}/mcp/tokens`).send({ name: "ci" });
    const post = (await u.agent.post(`/workspaces/${ws}/posts`).send({ body: "kept" })).body.data.id as string;
    expect((await u.agent.delete("/me").send({ confirmEmail: u.email.toUpperCase() })).status).toBe(204);
    expect((await u.agent.get("/workspaces")).status).toBe(401);                                  // session is gone
    expect((await login(u.email)).status).toBeGreaterThanOrEqual(400);                            // login is gone
    const row = (await t.db.query<{ name: string; email: string }>(`SELECT name, email FROM "user" WHERE id = $1`, [u.id])).rows[0]!;
    expect(row).toMatchObject({ name: "Deleted user", email: `deleted-${u.id}@deleted.invalid` });
    expect((await t.db.query("SELECT 1 FROM workspace_members WHERE user_id = $1", [u.id])).rowCount).toBe(0);
    expect((await t.db.query("SELECT 1 FROM mcp_grants WHERE user_id = $1", [u.id])).rowCount).toBe(0);
    expect((await heir.agent.get(`/workspaces/${ws}/posts/${post}`)).status).toBe(200);          // content stays with the workspace
    expect((await t.db.query("SELECT 1 FROM audit_logs WHERE action = 'account.deleted' AND entity_id = $1", [u.id])).rowCount).toBe(1);
  });
});

describe("username sign-in", async () => {
  const t = await createTestApp();
  afterAll(t.close);
  const signUp = (username: string, email: string) =>
    request(t.app).post("/api/auth/sign-up/email").set("Origin", ORIGIN).send({ name: username, email, username, password: "correct-horse-battery" });

  it("signs up with a username and signs in with it; a wrong password fails", async () => {
    expect((await signUp("maya_writes", "maya@example.com")).status).toBe(200);
    const agent = request.agent(t.app);
    const ok = await agent.post("/api/auth/sign-in/username").set("Origin", ORIGIN).send({ username: "maya_writes", password: "correct-horse-battery" });
    expect(ok.status).toBe(200);
    expect((await agent.get("/workspaces")).status).toBe(200);
    const bad = await request(t.app).post("/api/auth/sign-in/username").set("Origin", ORIGIN).send({ username: "maya_writes", password: "wrong-password-123" });
    expect(bad.status).toBe(401);
  });
  it("usernames are unique, case-insensitively", async () => {
    expect((await signUp("Sam_Posts", "sam1@example.com")).status).toBe(200);
    expect((await signUp("sam_posts", "sam2@example.com")).status).toBeGreaterThanOrEqual(400);
  });
});

describe("Google sign-in", async () => {
  const on = await createTestApp([], { env: { GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "test-secret" } });
  afterAll(on.close);
  const off = await createTestApp();
  afterAll(off.close);
  const start = (app: typeof on.app) => request(app).post("/api/auth/sign-in/social").set("Origin", ORIGIN).send({ provider: "google", callbackURL: `${ORIGIN}/app` });

  it("returns a Google consent URL when Google is configured", async () => {
    const r = await start(on.app);
    expect(r.status).toBe(200);
    const url = new URL(r.body.url);
    expect(url.hostname).toBe("accounts.google.com");
    expect(url.searchParams.get("client_id")).toBe("test-client.apps.googleusercontent.com");
    expect(url.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/auth/callback/google`);
  });
  it("is refused when Google is not configured", async () => {
    expect((await start(off.app)).status).toBeGreaterThanOrEqual(400);
  });
});
