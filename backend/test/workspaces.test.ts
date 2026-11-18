import { describe, it, expect, afterAll } from "vitest";
import { createTestApp } from "./helpers/app.js";

describe("workspaces, RBAC and isolation", async () => {
  const t = await createTestApp();
  afterAll(t.close);
  const mk = async (u: Awaited<ReturnType<typeof t.newUser>>, name = "Acme") => (await u.agent.post("/workspaces").send({ name })).body.data.id as string;
  /** invite + accept helper: returns the member user */
  async function join(owner: Awaited<ReturnType<typeof t.newUser>>, ws: string, role: string) {
    const m = await t.newUser(role);
    const inv = await owner.agent.post(`/workspaces/${ws}/invitations`).send({ email: m.email, role });
    expect(inv.status).toBe(201);
    const token = /token=([\w-]+)/.exec(t.sent.at(-1)!.html)![1];
    expect((await m.agent.post("/invitations/accept").send({ token })).status).toBe(200);
    return m;
  }

  it("creator becomes owner and sees only own workspaces", async () => {
    const a = await t.newUser("a"), b = await t.newUser("b");
    const wsA = await mk(a, "A-corp");
    await mk(b, "B-corp");
    const list = (await a.agent.get("/workspaces")).body.data;
    expect(list.map((w: { name: string }) => w.name)).toEqual(["A-corp"]);
    expect(list[0].role).toBe("owner");
    expect((await a.agent.get(`/workspaces/${wsA}`)).status).toBe(200);
  });

  it("isolation: other tenant gets 404 on every workspace route (no existence leak)", async () => {
    const a = await t.newUser("a"), b = await t.newUser("b");
    const ws = await mk(a);
    const routes: [string, string][] = [
      ["get", `/workspaces/${ws}`], ["patch", `/workspaces/${ws}`], ["get", `/workspaces/${ws}/members`],
      ["get", `/workspaces/${ws}/invitations`], ["get", `/workspaces/${ws}/audit-logs`], ["patch", `/workspaces/${ws}/members/${a.id}`],
      ["delete", `/workspaces/${ws}/members/${a.id}`], ["post", `/workspaces/${ws}/invitations`],
    ];
    for (const [method, url] of routes) {
      const r = await (b.agent as never as Record<string, (u: string) => { send: (b: unknown) => Promise<{ status: number }> }>)[method]!(url).send({ name: "x", role: "viewer", email: "x@example.com" });
      expect(r.status, `${method} ${url}`).toBe(404);
    }
    const stillOwner = (await a.agent.get(`/workspaces/${ws}/members`)).body.data;
    expect(stillOwner).toHaveLength(1);
  });

  it("RBAC: viewer/editor cannot manage members; admin cannot touch owner or grant admin", async () => {
    const owner = await t.newUser("owner");
    const ws = await mk(owner);
    const viewer = await join(owner, ws, "viewer");
    const editor = await join(owner, ws, "editor");
    const admin = await join(owner, ws, "admin");
    expect((await viewer.agent.post(`/workspaces/${ws}/invitations`).send({ email: "n@example.com", role: "viewer" })).status).toBe(403);
    expect((await editor.agent.patch(`/workspaces/${ws}/members/${viewer.id}`).send({ role: "admin" })).status).toBe(403);
    expect((await viewer.agent.get(`/workspaces/${ws}`)).status).toBe(200);
    expect((await viewer.agent.patch(`/workspaces/${ws}`).send({ name: "Hax" })).status).toBe(403);
    expect((await admin.agent.patch(`/workspaces/${ws}/members/${owner.id}`).send({ role: "viewer" })).status).toBe(403);
    expect((await admin.agent.patch(`/workspaces/${ws}/members/${viewer.id}`).send({ role: "admin" })).status).toBe(403);
    expect((await admin.agent.patch(`/workspaces/${ws}/members/${viewer.id}`).send({ role: "analyst" })).status).toBe(200);
    expect((await admin.agent.delete(`/workspaces/${ws}/members/${owner.id}`)).status).toBe(403);
  });

  it("a workspace cannot lose its last owner", async () => {
    const owner = await t.newUser("owner");
    const ws = await mk(owner);
    const demote = await owner.agent.patch(`/workspaces/${ws}/members/${owner.id}`).send({ role: "admin" });
    expect(demote.status).toBe(409);
    expect(demote.body.error.code).toBe("LAST_OWNER");
    expect((await owner.agent.delete(`/workspaces/${ws}/members/${owner.id}`)).status).toBe(409);
  });

  it("invitations: wrong account cannot consume, token is single-use, raw token never stored", async () => {
    const owner = await t.newUser("owner");
    const ws = await mk(owner);
    const invitee = await t.newUser("invitee"), stranger = await t.newUser("stranger");
    await owner.agent.post(`/workspaces/${ws}/invitations`).send({ email: invitee.email, role: "editor" });
    const token = /token=([\w-]+)/.exec(t.sent.at(-1)!.html)![1]!;
    const stored = (await t.db.query<{ token_hash: string }>("SELECT token_hash FROM workspace_invitations WHERE workspace_id = $1", [ws])).rows;
    expect(stored.map((r) => r.token_hash)).not.toContain(token);
    expect((await stranger.agent.post("/invitations/accept").send({ token })).status).toBe(403);
    expect((await stranger.agent.get(`/workspaces/${ws}`)).status).toBe(404); // rolled back: not a member
    expect((await invitee.agent.post("/invitations/accept").send({ token })).status).toBe(200); // still usable by the right user
    expect((await invitee.agent.post("/invitations/accept").send({ token })).status).toBe(400); // single use
    expect((await invitee.agent.get(`/workspaces/${ws}`)).body.data.role).toBe("editor");
  });

  it("duplicate open invitation is rejected; revoked invitation cannot be accepted", async () => {
    const owner = await t.newUser("owner");
    const ws = await mk(owner);
    const u = await t.newUser("inv");
    const first = await owner.agent.post(`/workspaces/${ws}/invitations`).send({ email: u.email, role: "viewer" });
    expect((await owner.agent.post(`/workspaces/${ws}/invitations`).send({ email: u.email, role: "viewer" })).status).toBe(409);
    const token = /token=([\w-]+)/.exec(t.sent.at(-1)!.html)![1];
    expect((await owner.agent.delete(`/workspaces/${ws}/invitations/${first.body.data.id}`)).status).toBe(204);
    expect((await u.agent.post("/invitations/accept").send({ token })).status).toBe(400);
  });

  it("owner cannot be invited directly; invalid input is rejected with VALIDATION_ERROR", async () => {
    const owner = await t.newUser("owner");
    const ws = await mk(owner);
    const r = await owner.agent.post(`/workspaces/${ws}/invitations`).send({ email: "a@example.com", role: "owner" });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("VALIDATION_ERROR");
    expect((await owner.agent.get("/workspaces/not-a-uuid")).status).toBe(400);
  });

  it("audit log records actions, newest first, with keyset pagination", async () => {
    const owner = await t.newUser("owner");
    const ws = await mk(owner);
    await owner.agent.patch(`/workspaces/${ws}`).send({ name: "Renamed" });
    await owner.agent.post(`/workspaces/${ws}/invitations`).send({ email: "p@example.com", role: "viewer" });
    const p1 = (await owner.agent.get(`/workspaces/${ws}/audit-logs?limit=2`)).body;
    expect(p1.data.map((r: { action: string }) => r.action)).toEqual(["invitation.created", "workspace.updated"]);
    expect(p1.meta.nextCursor).toBeTruthy();
    const p2 = (await owner.agent.get(`/workspaces/${ws}/audit-logs?limit=2&cursor=${p1.meta.nextCursor}`)).body;
    expect(p2.data.map((r: { action: string }) => r.action)).toEqual(["workspace.created"]);
    expect(p2.meta.nextCursor).toBeNull();
  });

  it("workspace list paginates", async () => {
    const u = await t.newUser("pg");
    for (const n of ["1", "2", "3"]) await mk(u, `W${n}`);
    const p1 = (await u.agent.get("/workspaces?limit=2")).body;
    expect(p1.data).toHaveLength(2);
    const p2 = (await u.agent.get(`/workspaces?limit=2&cursor=${p1.meta.nextCursor}`)).body;
    expect(p2.data).toHaveLength(1);
    expect(p2.meta.nextCursor).toBeNull();
  });
});

describe("workspace deletion", async () => {
  const { createFakeAdapter, ok } = await import("./helpers/fake-adapter.js");
  const { createTestApp } = await import("./helpers/app.js");
  const { world, publish, drain } = await import("./helpers/world.js");
  const t = await createTestApp([createFakeAdapter("linkedin", () => ok()).adapter]);
  afterAll(t.close);

  it("owner deletes a fully populated workspace (accounts, credentials, posts, jobs, grants) after typing its name; others cannot", async () => {
    const { owner, ws, post } = await world(t, ["linkedin"]);
    await publish(owner, ws, post); await drain(t);
    await owner.agent.post(`/workspaces/${ws}/mcp/tokens`).send({ name: "ci" });
    const name = (await owner.agent.get(`/workspaces/${ws}`)).body.data.name as string;
    const admin = await t.newUser("adm");
    await t.db.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'admin')", [ws, admin.id]);
    expect((await admin.agent.delete(`/workspaces/${ws}`).send({ confirmName: name })).status).toBe(403);
    expect((await owner.agent.delete(`/workspaces/${ws}`).send({ confirmName: "wrong" })).status).toBe(400);
    expect((await owner.agent.delete(`/workspaces/${ws}`).send({ confirmName: name })).status).toBe(204);
    expect((await owner.agent.get(`/workspaces/${ws}`)).status).toBe(404);
    for (const table of ["social_accounts", "posts", "publishing_jobs", "oauth_credentials", "mcp_grants"]) expect((await t.db.query(`SELECT 1 FROM ${table} WHERE workspace_id = $1`, [ws])).rowCount, table).toBe(0);
    expect((await t.db.query("SELECT 1 FROM audit_logs WHERE action = 'workspace.deleted' AND entity_id = $1", [ws])).rowCount).toBe(1);
  });

  it("refuses while a paid subscription is live", async () => {
    const { owner, ws } = await world(t, ["linkedin"]);
    await t.db.query("INSERT INTO billing_subscriptions (workspace_id, plan_version_id, status, currency, interval) SELECT $1, v.id, 'active', 'INR', 'month' FROM billing_plan_versions v JOIN billing_plans p ON p.id = v.plan_id WHERE v.active AND p.key = 'pro'", [ws]);
    const name = (await owner.agent.get(`/workspaces/${ws}`)).body.data.name as string;
    const r = await owner.agent.delete(`/workspaces/${ws}`).send({ confirmName: name });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("ACTIVE_SUBSCRIPTION");
  });
});
