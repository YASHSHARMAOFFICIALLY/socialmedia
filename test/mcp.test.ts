import { describe, it, expect, afterAll } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { buildMcpServer, TOOLS } from "../src/modules/mcp/mcp.server.js";
import type { Principal } from "../src/modules/mcp/mcp.types.js";
import { SCOPES } from "../src/modules/mcp/mcp.types.js";
import { createFakeAdapter, metricsOf, ok } from "./helpers/fake-adapter.js";
import { createTestApp } from "./helpers/app.js";
import { world, type T, type U } from "./helpers/world.js";

const ALL = [...SCOPES];
describe("MCP core (tools, resources, prompts) over the real SDK", async () => {
  const x = createFakeAdapter("x", () => ok(), { postMetrics: () => metricsOf({ "public_metrics.impression_count": 1000, "public_metrics.like_count": 40, "public_metrics.reply_count": 5, "public_metrics.retweet_count": 7, "public_metrics.quote_count": 2, "public_metrics.bookmark_count": 3 }), accountMetrics: () => metricsOf({ "public_metrics.followers_count": 500 }) });
  const t = await createTestApp([x.adapter]);
  const clients: Client[] = [];
  afterAll(async () => { for (const c of clients) await c.close().catch(() => {}); await t.close(); });
  const deps = () => ({ db: t.db, log: t.deps.log, workspaces: t.deps.workspaces, accounts: t.deps.accounts, content: t.deps.content, analytics: t.deps.analytics, billing: t.deps.billing, billingPayments: t.deps.billingPayments });

  /** A client connected through the production handler path (per-request factory) as the given principal. */
  async function connect(p: Principal) {
    const handler = createMcpHandler(() => buildMcpServer(deps(), p));
    const c = new Client({ name: "test", version: "1" }, { versionNegotiation: { mode: "auto" } });
    await c.connect(new StreamableHTTPClientTransport(new URL("http://test.local/mcp"), { fetch: (u, i) => handler.fetch(new Request(u, i)) }));
    clients.push(c);
    return c;
  }
  const principal = (u: U, o: Partial<Principal> = {}): Principal => ({ userId: u.id, email: `${u.id}@t.test`, scopes: ALL, ...o });
  const call = async (c: Client, name: string, args: object = {}) => { const r = await c.callTool({ name, arguments: args }); return { isError: r.isError === true, data: r.structuredContent as Record<string, any> }; };
  const upgrade = (ws: string, plan = "pro") => t.db.query("INSERT INTO billing_subscriptions (workspace_id, plan_version_id, status, currency, interval) SELECT $1, v.id, 'active', 'INR', 'month' FROM billing_plan_versions v JOIN billing_plans p ON p.id = v.plan_id WHERE p.key = $2", [ws, plan]);
  const seedPublished = async (ws: string, owner: U, account: string) => {
    const post = (await owner.agent.post(`/workspaces/${ws}/posts`).send({ body: "hello", variants: [{ accountId: account }] })).body.data.id as string;
    const v = (await t.db.query<{ id: string }>("SELECT id FROM post_variants WHERE post_id = $1", [post])).rows[0]!.id;
    await t.db.query("INSERT INTO publishing_jobs (workspace_id, post_id, variant_id, social_account_id, platform, status, next_attempt_at, published_at, external_id, external_url, created_by, idempotency_key) VALUES ($1,$2,$3,$4,'x','published',now(),now() - interval '1 day',$5,$6,$7,$8)", [ws, post, v, account, `ext-${post}`, `https://x.example/${post}`, owner.id, `k-${post}`]);
    await t.deps.engine.analytics.sweep();
    while (t.analyticsQueued.length) await t.deps.engine.analytics.collect(t.analyticsQueued.shift()!);
    return post;
  };

  it("registers 15 tools, 6 resources and 4 prompts with read-only annotations", async () => {
    const { owner } = await world(t, ["x"]);
    const c = await connect(principal(owner));
    const tools = (await c.listTools()).tools;
    expect(tools.map((x) => x.name).sort()).toEqual(["compare_platform_performance", "create_billing_portal_session", "get_account_analytics", "get_analytics_overview", "get_available_plans", "get_current_plan", "get_engagement_trends", "get_follower_growth", "get_post_analytics", "get_subscription", "get_top_posts", "get_usage_summary", "list_invoices", "list_recent_posts", "list_social_accounts"]);
    expect(TOOLS.length).toBe(15);
    for (const tool of tools) { expect(tool.description!.length, tool.name).toBeGreaterThan(40); expect(tool.annotations?.readOnlyHint, tool.name).toBe(tool.name !== "create_billing_portal_session"); }   // the portal tool mints a link and writes an audit row: not read-only
    expect((await c.listResources()).resources.map((r) => r.uri).sort()).toEqual(["analytics://metric-definitions", "analytics://overview", "analytics://top-posts", "billing://subscription", "billing://usage", "social://accounts"]);
    expect((await c.listPrompts()).prompts.map((p) => p.name).sort()).toEqual(["content-repurposing", "cross-platform-content-analysis", "subscription-usage-review", "weekly-performance-review"]);
  });

  it("entitlements: Free plan cannot use analytics over MCP (PLAN_LIMIT_REACHED) but can read billing; Pro can use both", async () => {
    const { owner, ws } = await world(t, ["x"]);
    const c = await connect(principal(owner));
    const blocked = await call(c, "get_analytics_overview");
    expect(blocked.isError).toBe(true);
    expect(blocked.data.error).toMatchObject({ code: "PLAN_LIMIT_REACHED", details: { feature: "mcp_access", plan: "free" } });
    expect((await call(c, "get_current_plan")).data.plan.key).toBe("free");
    expect((await call(c, "get_available_plans")).data.plans.map((p: { key: string }) => p.key)).toEqual(["free", "starter", "pro", "agency"]);
    await upgrade(ws);
    const okr = await call(c, "get_analytics_overview");
    expect(okr.isError).toBe(false);
    expect(okr.data.freshness).toBeDefined();
  });

  it("analytics tools return real data with availability + freshness; accounts never expose credentials", async () => {
    const { owner, ws, accounts } = await world(t, ["x"]);
    await upgrade(ws);
    const post = await seedPublished(ws, owner, accounts.x!);
    const c = await connect(principal(owner));
    const acc = await call(c, "list_social_accounts");
    expect(acc.data.items).toHaveLength(1);
    expect(JSON.stringify(acc.data)).not.toMatch(/token|secret|plain-access/i);
    const ov = await call(c, "get_analytics_overview");
    const px = ov.data.data.platforms.find((p: { platform: string }) => p.platform === "x");
    expect(px.metrics.impressions.total).toBe(1000);
    expect(ov.data.freshness.platforms[0]).toMatchObject({ platform: "x", analyticsSupported: { posts: true } });
    expect(ov.data.freshness.platforms[0].lastCollectedAt).not.toBeNull();
    expect((await call(c, "get_account_analytics", { accountId: accounts.x })).isError).toBe(false);
    expect((await call(c, "get_post_analytics", { postId: post })).data.data.destinations[0].analytics.state).toBe("collected");
    expect((await call(c, "get_top_posts", { limit: 3 })).data.data.posts[0].value).toBe(57);
    expect((await call(c, "compare_platform_performance")).isError).toBe(false);
    expect((await call(c, "get_follower_growth")).data.data.metric).toBe("followers");
    expect((await call(c, "get_engagement_trends", { metric: "likes" })).data.data.metric).toBe("likes");
    expect((await call(c, "list_recent_posts")).data.items[0]).toMatchObject({ id: post, preview: "hello" });
  });

  it("validation: bad dates, ranges over 366 days and unknown metrics are errors, not fabricated data", async () => {
    const { owner, ws } = await world(t, ["x"]);
    await upgrade(ws);
    const c = await connect(principal(owner));
    expect((await call(c, "get_analytics_overview", { from: "yesterday" })).isError).toBe(true);
    expect((await call(c, "get_analytics_overview", { from: "2026-13-45" })).isError).toBe(true);     // well-formed but not a date: rejected up front, not a SQL error
    const long = await call(c, "get_analytics_overview", { from: "2020-01-01", to: "2024-01-01" });
    expect(long.isError).toBe(true);
    expect(long.data.error.message).toMatch(/366/);
    expect((await call(c, "get_engagement_trends", { metric: "nope" })).data.error.message).toMatch(/Unknown metric/);
  });

  it("workspace is never trusted: strangers get NOT_FOUND, bound tokens cannot cross workspaces, scopes are enforced, multi-workspace needs an id", async () => {
    const a = await world(t, ["x"]), b = await world(t, ["x"]);
    await upgrade(a.ws); await upgrade(b.ws);
    const stranger = await connect(principal(b.owner));
    expect((await call(stranger, "get_analytics_overview", { workspaceId: a.ws })).data.error.code).toBe("NOT_FOUND");
    expect((await call(stranger, "get_subscription", { workspaceId: a.ws })).data.error.code).toBe("NOT_FOUND");   // billing too; plan of another tenant not revealed
    const bound = await connect(principal(a.owner, { workspaceId: a.ws }));
    expect((await call(bound, "get_analytics_overview")).isError).toBe(false);                                      // defaults to the bound workspace
    const other = await world(t, ["x"]);
    await t.db.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'owner')", [other.ws, a.owner.id]);
    expect((await call(bound, "get_analytics_overview", { workspaceId: other.ws })).data.error.code).toBe("FORBIDDEN");   // member of both, but token bound to one
    const unbound = await connect(principal(a.owner));
    expect((await call(unbound, "get_analytics_overview")).data.error.code).toBe("WORKSPACE_REQUIRED");           // two workspaces: must say which
    const narrow = await connect(principal(a.owner, { workspaceId: a.ws, scopes: ["billing:read"] }));
    expect((await call(narrow, "get_analytics_overview")).data.error.code).toBe("INSUFFICIENT_SCOPE");
    expect((await call(narrow, "get_current_plan")).isError).toBe(false);
  });

  it("role permissions still apply: an analyst cannot read billing through MCP; the portal is owner-only and needs a billing account", async () => {
    const { owner, ws } = await world(t, ["x"]);
    await upgrade(ws);
    const analyst = await t.newUser("an");
    await t.db.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'analyst')", [ws, analyst.id]);
    const ca = await connect(principal(analyst, { workspaceId: ws }));
    expect((await call(ca, "get_analytics_overview")).isError).toBe(false);
    expect((await call(ca, "get_subscription")).data.error.code).toBe("FORBIDDEN");
    const co = await connect(principal(owner, { workspaceId: ws }));
    expect((await call(co, "create_billing_portal_session")).data.error.code).toMatch(/NO_BILLING_CUSTOMER|PAYMENTS_NOT_CONFIGURED/);
  });

  it("resources and prompts use the same gates and return real data; prompts separate facts from recommendations", async () => {
    const { owner, ws, accounts } = await world(t, ["x"]);
    const free = await connect(principal(owner, { workspaceId: ws }));
    await expect(free.readResource({ uri: "analytics://overview" })).rejects.toThrow();                            // Free: no MCP entitlement
    expect(JSON.parse((await free.readResource({ uri: "billing://usage" })).contents[0]!.text as string).plan).toBe("free");
    await upgrade(ws);
    await seedPublished(ws, owner, accounts.x!);
    const c = await connect(principal(owner, { workspaceId: ws }));
    const ov = JSON.parse((await c.readResource({ uri: "analytics://overview" })).contents[0]!.text as string);
    expect(ov.data.platforms[0].platform).toBe("x");
    expect(JSON.parse((await c.readResource({ uri: "social://accounts" })).contents[0]!.text as string).items).toHaveLength(1);
    expect(JSON.parse((await c.readResource({ uri: "analytics://metric-definitions" })).contents[0]!.text as string).length).toBeGreaterThan(5);
    const p = await c.getPrompt({ name: "weekly-performance-review", arguments: {} });
    const text = (p.messages[0]!.content as { text: string }).text;
    expect(text).toContain("FACTS");
    expect(text).toContain("Recommendations (my suggestions, not data)");
    expect(text).toContain('"impressions"');
    expect((await c.getPrompt({ name: "subscription-usage-review", arguments: {} })).messages.length).toBe(1);
  });

  it("every call is audited without arguments or results", async () => {
    const { owner, ws } = await world(t, ["x"]);
    await upgrade(ws);
    const c = await connect(principal(owner, { workspaceId: ws, clientId: "client-1" }));
    await call(c, "list_recent_posts", { status: "SECRET-FILTER" });
    const rows = (await t.db.query<{ action: string; entity_id: string; metadata: unknown }>("SELECT action, entity_id, metadata FROM audit_logs WHERE workspace_id = $1 AND action LIKE 'mcp.%'", [ws])).rows;
    expect(rows).toEqual([{ action: "mcp.tool_call", entity_id: "list_recent_posts", metadata: { outcome: "ok", clientId: "client-1" } }]);
    expect(JSON.stringify(rows)).not.toContain("SECRET-FILTER");
  });
});
