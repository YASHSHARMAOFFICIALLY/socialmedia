import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { createTestApp, ORIGIN } from "./helpers/app.js";
import { revokeUnverifiedLocalAccess } from "../src/modules/auth/claim.js";


// Someone registers the victim's email with their own password (never verified). When the real owner signs in with
// Google/Microsoft, the provider-verified email must win: link it, and cut every way in the squatter set up.
describe("a verified social sign-in claims an unverified password account", async () => {
  const t = await createTestApp();
  afterAll(t.close);
  const login = (email: string) =>
    request(t.app).post("/api/auth/sign-in/email").set("Origin", ORIGIN).send({ email, password: "correct-horse-battery" });

  it("the account accepts the provider link instead of answering account_not_linked", () => {
    expect(t.deps.auth.options.account?.accountLinking?.requireLocalEmailVerified).toBe(false);
  });

  it("removes the squatter's password, sessions and MCP tokens", async () => {
    const squatter = await t.newUser("squat");
    const ws = (await squatter.agent.post("/workspaces").send({ name: "Theirs" })).body.data.id as string;
    expect((await squatter.agent.post(`/workspaces/${ws}/mcp/tokens`).send({ name: "backdoor" })).status).toBe(201);
    await t.db.query(`UPDATE "user" SET "emailVerified" = false WHERE id = $1`, [squatter.id]);

    await revokeUnverifiedLocalAccess(t.db, squatter.id);

    expect((await squatter.agent.get("/workspaces")).status).toBe(401);
    expect((await login(squatter.email)).status).toBeGreaterThanOrEqual(400);
    const live = await t.db.query("SELECT 1 FROM mcp_grants WHERE user_id = $1 AND revoked_at IS NULL", [squatter.id]);
    expect(live.rowCount).toBe(0);
  });

  it("leaves a verified user's password and sessions alone", async () => {
    const owner = await t.newUser("legit");
    await t.db.query(`UPDATE "user" SET "emailVerified" = true WHERE id = $1`, [owner.id]);
    await revokeUnverifiedLocalAccess(t.db, owner.id);
    expect((await owner.agent.get("/workspaces")).status).toBe(200);
    expect((await login(owner.email)).status).toBe(200);
  });
});
