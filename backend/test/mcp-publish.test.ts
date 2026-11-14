import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { buildMcpServer } from "../src/modules/mcp/mcp.server.js";
import { SCOPES, type Principal } from "../src/modules/mcp/mcp.types.js";
import { createFakeAdapter, ok } from "./helpers/fake-adapter.js";
import { createTestApp, ORIGIN } from "./helpers/app.js";
import { world, drain, jobs, type U } from "./helpers/world.js";

describe("MCP publishing: prepare_publish -> user confirms -> publish_post", async () => {
  const x = createFakeAdapter("x", () => ok());
  const t = await createTestApp([x.adapter]);
  const clients: Client[] = [];
  afterAll(async () => { for (const c of clients) await c.close().catch(() => {}); await t.close(); });
  const deps = () => ({ db: t.db, log: t.deps.log, workspaces: t.deps.workspaces, accounts: t.deps.accounts, content: t.deps.content, analytics: t.deps.analytics, billing: t.deps.billing, billingPayments: t.deps.billingPayments, publishing: t.deps.publishing, confirmSecret: "test-confirm-secret-0123456789" });
  async function connect(p: Principal) {
    const handler = createMcpHandler(() => buildMcpServer(deps(), p));
    const c = new Client({ name: "test", version: "1" }, { versionNegotiation: { mode: "auto" } });
    await c.connect(new StreamableHTTPClientTransport(new URL("http://test.local/mcp"), { fetch: (u, i) => handler.fetch(new Request(u, i)) }));
    clients.push(c);
    return c;
  }
  const principal = (u: U, scopes: string[] = [...SCOPES]): Principal => ({ userId: u.id, email: `${u.id}@t.test`, scopes });
  const call = async (c: Client, name: string, args: object = {}) => { const r = await c.callTool({ name, arguments: args }); return { isError: r.isError === true, data: r.structuredContent as Record<string, any> }; };
  const upgrade = (ws: string) => t.db.query("INSERT INTO billing_subscriptions (workspace_id, plan_version_id, status, currency, interval) SELECT $1, v.id, 'active', 'INR', 'month' FROM billing_plan_versions v JOIN billing_plans p ON p.id = v.plan_id WHERE p.key = 'pro'", [ws]);
  const setup = async () => { const w = await world(t, ["x"]); await upgrade(w.ws); return { ...w, c: await connect(principal(w.owner)) }; };

  it("annotations: prepare_publish is read-only; publish_post is destructive and open-world so hosts ask the user", async () => {
    const { c } = await setup();
    const tools = Object.fromEntries((await c.listTools()).tools.map((x) => [x.name, x.annotations]));
    expect(tools["prepare_publish"]).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(tools["publish_post"]).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: true });
  });

  it("prepare_publish creates nothing; publish_post without a valid confirmation code creates nothing", async () => {
    const { ws, post, c } = await setup();
    const prep = await call(c, "prepare_publish", { postId: post });
    expect(prep.isError).toBe(false);
    expect(prep.data).toMatchObject({ postId: post, mode: "now", destinations: [{ platform: "x", publishable: true }] });
    expect(prep.data.confirmationCode).toMatch(/^[\w-]+\.[\w-]{20,}$/);
    expect((await jobs(t, ws)).length).toBe(0);
    const bad = await call(c, "publish_post", { postId: post, confirmationCode: prep.data.confirmationCode.slice(0, -2) + "xx" });
    expect(bad.data.error.code).toBe("CONFIRMATION_INVALID");
    expect((await jobs(t, ws)).length).toBe(0);
  });

  it("publish now: confirmed code publishes once; repeating the same call replays and creates no second job", async () => {
    const { ws, post, c } = await setup();
    const code = (await call(c, "prepare_publish", { postId: post })).data.confirmationCode;
    const first = await call(c, "publish_post", { postId: post, confirmationCode: code });
    expect(first.isError).toBe(false);
    expect(first.data.jobs).toHaveLength(1);
    const again = await call(c, "publish_post", { postId: post, confirmationCode: code });
    expect(again.isError).toBe(false);
    expect(again.data.replayed).toBe(true);
    expect((await jobs(t, ws)).length).toBe(1);
    await drain(t);
    expect((await jobs(t, ws))[0]!.status).toBe("published");
  });

  it("the code is bound to what was previewed: other post, other destinations, other time, or an edit after preview are refused", async () => {
    const { owner, ws, post, c, accounts } = await setup();
    const other = (await owner.agent.post(`/workspaces/${ws}/posts`).send({ body: "other", variants: [{ accountId: accounts["x"] }] })).body.data.id as string;
    const at = new Date(Date.now() + 3_600_000).toISOString();
    const code = (await call(c, "prepare_publish", { postId: post, scheduledAt: at, timezone: "UTC" })).data.confirmationCode;
    expect((await call(c, "publish_post", { postId: other, scheduledAt: at, timezone: "UTC", confirmationCode: code })).data.error.code).toBe("CONFIRMATION_INVALID");
    expect((await call(c, "publish_post", { postId: post, confirmationCode: code })).data.error.code).toBe("CONFIRMATION_INVALID");   // previewed as scheduled, called as "now"
    expect((await call(c, "publish_post", { postId: post, scheduledAt: new Date(Date.now() + 7_200_000).toISOString(), timezone: "UTC", confirmationCode: code })).data.error.code).toBe("CONFIRMATION_INVALID");
    expect((await owner.agent.patch(`/workspaces/${ws}/posts/${post}`).send({ body: "edited after preview" })).status).toBe(200);
    expect((await call(c, "publish_post", { postId: post, scheduledAt: at, timezone: "UTC", confirmationCode: code })).data.error.code).toBe("CONFIRMATION_STALE");
    expect((await jobs(t, ws)).length).toBe(0);
  });

  it("schedule: confirmed code schedules the post for the previewed time", async () => {
    const { ws, post, c } = await setup();
    const at = new Date(Date.now() + 3_600_000).toISOString();
    const prep = await call(c, "prepare_publish", { postId: post, scheduledAt: at, timezone: "UTC" });
    expect(prep.data).toMatchObject({ mode: "scheduled", scheduledAt: at });
    const out = await call(c, "publish_post", { postId: post, scheduledAt: at, timezone: "UTC", confirmationCode: prep.data.confirmationCode });
    expect(out.isError).toBe(false);
    expect((await jobs(t, ws)).map((j) => j.status)).toEqual(["scheduled"]);
  });

  it("needs the content:publish scope (not in the default grant)", async () => {
    const { owner, post } = await setup();
    const c = await connect(principal(owner, SCOPES.filter((s) => s !== "content:publish")));
    expect((await call(c, "prepare_publish", { postId: post })).data.error.code).toBe("INSUFFICIENT_SCOPE");
    expect((await call(c, "publish_post", { postId: post, confirmationCode: "x".repeat(30) })).data.error.code).toBe("INSUFFICIENT_SCOPE");
  });
});

describe("/mcp/authorize when the browser is not signed in", () => {
  it("redirects to the app's login page with a next= link back to this exact authorize URL", async () => {
    const t = await createTestApp([]);
    try {
      const qs = "client_id=dsc_x&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb&response_type=code&state=s";
      const r = await request(t.app).get(`/mcp/authorize?${qs}`);
      expect(r.status).toBe(302);
      const to = new URL(r.headers["location"]);
      expect(to.origin + to.pathname).toBe(`${ORIGIN}/login`);
      expect(to.searchParams.get("next")).toBe(`${ORIGIN}/mcp/authorize?${qs}`);
    } finally { await t.close(); }
  });

  it("without APP_URL configured it still answers 401", async () => {
    const t = await createTestApp([], { env: { APP_URL: undefined } as never });
    try { expect((await request(t.app).get("/mcp/authorize?client_id=dsc_x")).status).toBe(401); } finally { await t.close(); }
  });
});
