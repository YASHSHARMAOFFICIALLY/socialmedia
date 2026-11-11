import { mkdtempSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { authedFetch, normalizeApiUrl, pollDevice, refresh } from "../cli/src/api.js";
import { createProxyServer } from "../cli/src/proxy.js";
import { store } from "../cli/src/store.js";
import { createFakeAdapter, ok } from "./helpers/fake-adapter.js";
import { createTestApp } from "./helpers/app.js";
import { world } from "./helpers/world.js";

const json = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const dev = { device_code: "dsd_x", user_code: "ABCD-2345", verification_uri: "u", verification_uri_complete: "u?c", expires_in: 600, interval: 5 };

describe("CLI: login, refresh, storage", () => {
  beforeEach(() => { process.env["DISTORA_CONFIG_DIR"] = mkdtempSync(join(tmpdir(), "distora-")); });

  it("device polling honors authorization_pending and slow_down, then returns credentials; denial and expiry are errors", async () => {
    const replies = [json(400, { error: "authorization_pending" }), json(400, { error: "slow_down" }), json(200, { access_token: "A", refresh_token: "R", expires_in: 3600, workspace_id: "w", scope: "analytics:read" })];
    const sleeps: number[] = [];
    const c = await pollDevice("https://api.test", dev, { f: (async () => replies.shift()!) as never, sleep: async (ms) => { sleeps.push(ms); }, now: () => 0 });
    expect(c).toMatchObject({ apiUrl: "https://api.test", accessToken: "A", refreshToken: "R", workspaceId: "w" });
    expect(sleeps).toEqual([5000, 5000, 10000]);                                       // +5s after slow_down
    await expect(pollDevice("https://api.test", dev, { f: (async () => json(400, { error: "access_denied" })) as never, sleep: async () => {}, now: () => 0 })).rejects.toThrow(/denied/);
    let t = 0;
    await expect(pollDevice("https://api.test", dev, { f: (async () => json(400, { error: "authorization_pending" })) as never, sleep: async () => {}, now: () => (t += 400_000) })).rejects.toThrow(/expired/);
  });

  it("only https API URLs (http allowed for localhost)", () => {
    expect(normalizeApiUrl("https://api.example.com/x")).toBe("https://api.example.com");
    expect(normalizeApiUrl("http://localhost:8787")).toBe("http://localhost:8787");
    expect(() => normalizeApiUrl("http://api.example.com")).toThrow(/https/);
    expect(() => normalizeApiUrl("")).toThrow();
  });

  it("credentials file is private (0600); refresh saves the rotated token first and clears the store when the server rejects it", async () => {
    store.save({ apiUrl: "https://api.test", accessToken: "A1", refreshToken: "R1", expiresAt: 1 });
    expect(statSync(join(process.env["DISTORA_CONFIG_DIR"]!, "credentials.json")).mode & 0o777).toBe(0o600);
    const next = await refresh(store.load()!, (async () => json(200, { access_token: "A2", refresh_token: "R2", expires_in: 3600 })) as never);
    expect(next).toMatchObject({ accessToken: "A2", refreshToken: "R2" });
    expect(store.load()).toMatchObject({ accessToken: "A2", refreshToken: "R2" });
    await expect(refresh(store.load()!, (async () => json(400, { error: "invalid_grant" })) as never)).rejects.toThrow(/login/);
    expect(store.load()).toBeNull();
  });

  it("refresh adopts tokens another process already rotated, and a 429/5xx never wipes the stored login", async () => {
    store.save({ apiUrl: "https://api.test", accessToken: "A2", refreshToken: "R2", expiresAt: Date.now() + 3_600_000 });
    let calls = 0;
    const stale = { apiUrl: "https://api.test", accessToken: "A1", refreshToken: "R1", expiresAt: 1 };
    const got = await refresh(stale, (async () => { calls++; return json(400, { error: "invalid_grant" }); }) as never);
    expect(got.refreshToken).toBe("R2");
    expect(calls).toBe(0);                                             // used the newer tokens, never replayed the dead one
    store.save({ apiUrl: "https://api.test", accessToken: "A1", refreshToken: "R1", expiresAt: 1 });
    await expect(refresh(store.load()!, (async () => json(429, { error: "rate_limited" })) as never)).rejects.toThrow(/try again/);
    expect(store.load()?.refreshToken).toBe("R1");
    await expect(refresh(store.load()!, (async () => json(503, {})) as never)).rejects.toThrow(/try again/);
    expect(store.load()?.refreshToken).toBe("R1");
  });

  it("authedFetch refreshes shortly before expiry and sends the current bearer token", async () => {
    store.save({ apiUrl: "https://api.test", accessToken: "OLD", refreshToken: "R1", expiresAt: Date.now() + 10_000 });
    const seen: string[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/mcp/token")) return json(200, { access_token: "NEW", refresh_token: "R2", expires_in: 3600 });
      seen.push(new Headers(init?.headers).get("authorization")!); return json(200, {});
    }) as never;
    const af = authedFetch(store.load()!, f);
    await Promise.all([af("https://api.test/mcp"), af("https://api.test/mcp")]);        // concurrent calls share ONE refresh (the old token is single-use)
    expect(seen).toEqual(["Bearer NEW", "Bearer NEW"]);
  });
});

describe("CLI: bridge to the real server", async () => {
  const t = await createTestApp([createFakeAdapter("x", () => ok()).adapter]);
  const http = createServer(t.app);
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  const port = (http.address() as { port: number }).port;
  afterAll(async () => { http.close(); await t.close(); });

  async function pat() {
    const { owner, ws } = await world(t, ["x"]);
    await t.db.query("INSERT INTO billing_subscriptions (workspace_id, plan_version_id, status, currency, interval) SELECT $1, v.id, 'active', 'INR', 'month' FROM billing_plan_versions v JOIN billing_plans p ON p.id = v.plan_id WHERE p.key = 'pro'", [ws]);
    return (await owner.agent.post(`/workspaces/${ws}/mcp/tokens`).send({ name: "cli" })).body.data.token as string;
  }

  it("proxy exposes exactly the remote tools/resources/prompts and forwards calls (errors included)", async () => {
    const token = await pat();
    const remote = new Client({ name: "r", version: "1" }, { versionNegotiation: { mode: "auto" } });
    await remote.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), { fetch: authedFetch({ apiUrl: `http://127.0.0.1:${port}`, accessToken: token }) }));
    const proxy = await createProxyServer(remote);
    const local = createMcpHandler(() => proxy);
    const c = new Client({ name: "host", version: "1" }, { versionNegotiation: { mode: "auto" } });
    await c.connect(new StreamableHTTPClientTransport(new URL("http://local/mcp"), { fetch: (u, i) => local.fetch(new Request(u, i)) }));
    expect((await c.listTools()).tools.map((x) => x.name).sort()).toEqual((await remote.listTools()).tools.map((x) => x.name).sort());
    expect((await c.listResources()).resources).toHaveLength(6);
    expect((await c.listPrompts()).prompts).toHaveLength(4);
    const plan = await c.callTool({ name: "get_current_plan", arguments: {} });
    expect((plan.structuredContent as any).plan.key).toBe("pro");
    const bad = await c.callTool({ name: "get_account_analytics", arguments: { accountId: "not-a-uuid" } });
    expect(bad.isError).toBe(true);
    await c.close(); await remote.close();
  });

  it("stdio subprocess: `distora mcp serve` speaks clean MCP on stdout, logs to stderr, uses DISTORA_TOKEN", async () => {
    const token = await pat();
    const transport = new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", "cli/src/main.ts", "mcp", "serve"], env: { ...(process.env as Record<string, string>), DISTORA_TOKEN: token, DISTORA_API_URL: `http://127.0.0.1:${port}` }, stderr: "pipe" });
    let err = "";
    const c = new Client({ name: "host", version: "1" }, { versionNegotiation: { mode: "auto" } });
    await c.connect(transport);
    (transport as any).stderr?.on?.("data", (d: Buffer) => { err += d.toString(); });
    expect((await c.listTools()).tools.length).toBe(17);
    expect(((await c.callTool({ name: "get_available_plans", arguments: {} })).structuredContent as any).plans).toHaveLength(4);
    await c.close();
    expect(err).not.toContain(token);                                                    // secrets never in logs
  }, 60_000);

  it("serve without credentials fails with a clear message and exit code 1", async () => {
    const { spawnSync } = await import("node:child_process");
    const env = { ...process.env, DISTORA_CONFIG_DIR: mkdtempSync(join(tmpdir(), "distora-")) } as Record<string, string>;
    delete env["DISTORA_TOKEN"];
    const r = spawnSync(process.execPath, ["--import", "tsx", "cli/src/main.ts", "mcp", "serve"], { env, encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Not logged in");
    expect(r.stdout).toBe("");
  }, 30_000);
});
