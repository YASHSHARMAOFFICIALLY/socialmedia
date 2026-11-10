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
