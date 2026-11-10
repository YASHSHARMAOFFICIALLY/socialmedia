import { describe, it, expect, afterAll } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import express from "express";
import request from "supertest";
import pino from "pino";
import { redactPaths } from "../src/infrastructure/logger/logger.js";
import { createRateLimiter } from "../src/shared/middleware/rate-limit.js";
import { buildSpec } from "../src/shared/openapi.js";
import { createFakeAdapter, ok } from "./helpers/fake-adapter.js";
import { createTestApp } from "./helpers/app.js";
import { world } from "./helpers/world.js";
import { createTestDb } from "./helpers/pglite-db.js";
import { migrate } from "../src/infrastructure/database/migrate.js";

const PUBLIC_PREFIXES = ["/health/", "/openapi.json", "/docs", "/api/auth/", "/oauth/{platform}/callback", "/webhooks/"];
const isPublic = (p: string) => PUBLIC_PREFIXES.some((x) => p === x.replace(/\/$/, "") || p.startsWith(x));
const NIL = "00000000-0000-4000-8000-000000000001";
const fill = (p: string, ws: string) => p.replace("{workspaceId}", ws).replace("{platform}", "x").replace(/\{(\w+)\}/g, NIL);

describe("authorization sweep over EVERY documented endpoint", async () => {
  const li = createFakeAdapter("linkedin", () => ok());
  const t = await createTestApp([li.adapter]);
  afterAll(t.close);

  it("no documented endpoint answers an anonymous caller, a stranger, or a read-only member with data or a server error", async () => {
    const owner = await world(t, ["linkedin"]);
    const stranger = await t.newUser("stranger");
    const viewer = await t.newUser("viewer");
    await t.db.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'viewer')", [owner.ws, viewer.id]);
    const spec = buildSpec();
    const ops: { method: string; path: string }[] = [];
    for (const [p, item] of Object.entries(spec.paths ?? {})) for (const m of ["get", "post", "put", "patch", "delete"]) if ((item as Record<string, unknown>)[m] && !isPublic(p)) ops.push({ method: m, path: p });
    expect(ops.length).toBeGreaterThan(60);                                        // the sweep really covers the API surface
    const call = (agent: { [k: string]: (u: string) => { send: (b: unknown) => Promise<{ status: number }> } }, m: string, url: string) => agent[m]!(url).send({});
    const anon = request(t.app) as unknown as Parameters<typeof call>[0];
    const bad: string[] = [];
    for (const { method, path: p } of ops) {
      const url = fill(p, owner.ws);
      const a = await call(anon, method, url);
      if (a.status !== 401) bad.push(`anonymous ${method.toUpperCase()} ${p} -> ${a.status}`);
      const s = await call(stranger.agent as never, method, url);
      const OWN_SCOPE = ["/workspaces", "/platforms", "/billing/plans"];                                   // a user's own workspace list / static platform list
      if (method === "get" && OWN_SCOPE.includes(p)) { if (s.status !== 200) bad.push(`${p} -> ${s.status}`); continue; }
      if (![400, 403, 404, 429].includes(s.status)) bad.push(`stranger ${method.toUpperCase()} ${p} -> ${s.status}`);
      // A stranger must be treated as "workspace does not exist" whenever the request is otherwise valid.
      if (p.includes("{workspaceId}") && s.status === 403) bad.push(`stranger ${method.toUpperCase()} ${p} leaks existence (403)`);
    }
    expect(bad).toEqual([]);
    // read-only members can read but must not mutate anything (except their own notification state)
    const SELF_SERVICE = ["/notifications/read-all", "/notifications/{notificationId}/read", "/notification-preferences", "/invitations/accept"];
    const viewerBad: string[] = [];
    for (const { method, path: p } of ops) {
      if (method === "get" || SELF_SERVICE.some((x) => p.endsWith(x))) continue;
      if (!p.includes("{workspaceId}")) continue;
      const v = await call(viewer.agent as never, method, fill(p, owner.ws));
      if (v.status >= 200 && v.status < 300) viewerBad.push(`viewer ${method.toUpperCase()} ${p} -> ${v.status}`);
      if (v.status >= 500) viewerBad.push(`viewer ${method.toUpperCase()} ${p} -> ${v.status}`);
    }
    expect(viewerBad).toEqual([]);
  });
});

describe("SQL safety", () => {
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : []; });
  // The only interpolations allowed inside SQL templates are module-level constant column lists and a fixed FOR UPDATE suffix.
  const ALLOWED = [/^(COLS|PUBLIC|ALL|SAFE|POST_COLS|WS)$/, /^lock \? " FOR UPDATE" : ""$/, /^(COLS|PUBLIC)\.split\(", "\)\.map\(.*\)\.join\(", "\)$/];

  it("no SQL statement is built from variables other than constant column lists (everything else is a $n parameter)", () => {
    const offenders: string[] = [];
    for (const file of walk("src").filter((f) => !f.includes("/migrations/"))) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/`([^`]*(?:SELECT|INSERT INTO|UPDATE|DELETE FROM)[^`]*)`/g)) {
        for (const e of m[1]!.matchAll(/\$\{([^}]*(?:\([^)]*\))?[^}]*)\}/g)) {
          const expr = e[1]!.trim();
          if (!ALLOWED.some((r) => r.test(expr))) offenders.push(`${file}: \${${expr}}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the guard itself works: a concatenated statement would be flagged", () => {
    const sample = "const q = `SELECT * FROM users WHERE name = '${name}'`;";
    const hit = [...sample.matchAll(/`([^`]*(?:SELECT)[^`]*)`/g)].flatMap((m) => [...m[1]!.matchAll(/\$\{([^}]*)\}/g)].map((e) => e[1]!.trim()));
    expect(hit.filter((x) => !ALLOWED.some((r) => r.test(x)))).toEqual(["name"]);
  });
});

describe("secrets and logs", () => {
  it("redacts tokens, passwords and credentials in structured logs", () => {
    const lines: string[] = [];
    const log = pino({ redact: { paths: redactPaths, censor: "[REDACTED]" } }, { write: (s: string) => void lines.push(s) } as never);
    log.info({ req: { headers: { authorization: "Bearer SECRET-TOKEN", cookie: "session=SECRET-COOKIE" } }, account: { accessToken: "AT-SECRET", refresh_token: "RT-SECRET" }, user: { password: "pw-SECRET" } }, "evt");
    const out = lines.join("");
    for (const secret of ["SECRET-TOKEN", "SECRET-COOKIE", "AT-SECRET", "RT-SECRET", "pw-SECRET"]) expect(out).not.toContain(secret);
    expect(out).toContain("[REDACTED]");
  });

  it("source contains no hard-coded credentials", () => {
    const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : []; });
    const hits: string[] = [];
    for (const f of walk("src")) {
      const src = readFileSync(f, "utf8");
      if (/(sk_live_|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|xox[bp]-[0-9a-zA-Z-]+|re_[A-Za-z0-9]{20,})/.test(src)) hits.push(f);
    }
    expect(hits).toEqual([]);
  });
});

describe("HTTP hardening", async () => {
  const t = await createTestApp([createFakeAdapter("linkedin", () => ok()).adapter], { env: { CORS_ORIGINS: "https://app.example.com" } });
  afterAll(t.close);

  it("blocks cross-site state-changing requests (Origin check) but allows the app, same-origin and non-browser clients", async () => {
    const u = await t.newUser("o");
    const post = (origin?: string) => { const r = u.agent.post("/workspaces").send({ name: "W" }); return origin ? r.set("Origin", origin) : r; };
    const evil = await post("https://evil.example");
    expect(evil.status).toBe(403);
    expect(evil.body.error.code).toBe("ORIGIN_NOT_ALLOWED");
    expect((await post("https://app.example.com")).status).toBe(201);
    expect((await post()).status).toBe(201);
    expect((await u.agent.get("/workspaces").set("Origin", "https://evil.example")).status).toBe(200);     // reads are not state-changing
  });

  it("API responses are never cacheable; security headers are present; stack traces never leak", async () => {
    const u = await t.newUser("h");
    const r = await u.agent.get("/workspaces");
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["x-powered-by"]).toBeUndefined();
    expect(r.headers["strict-transport-security"]).toBeDefined();
    expect((await request(t.app).get("/docs")).headers["cache-control"]).not.toBe("no-store");
    const big = await u.agent.post("/workspaces").send({ name: "x".repeat(2 * 1024 * 1024) });
    expect(big.status).toBe(413);                                                                          // 1 MB body cap
    expect(JSON.stringify(big.body)).not.toMatch(/at .*\(.*:\d+:\d+\)|node_modules/);
  });

  it("every error carries the request id and a stable code", async () => {
    const r = await request(t.app).get("/workspaces").set("x-request-id", "trace-12345678");
    expect(r.headers["x-request-id"]).toBe("trace-12345678");
    expect(r.body.error).toMatchObject({ code: "UNAUTHORIZED", requestId: "trace-12345678" });
    const forged = await request(t.app).get("/workspaces").set("x-request-id", "bad id with spaces <script>");
    expect(forged.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);               // anything not a safe token is replaced, never echoed
    const u = await t.newUser("j");
    const malformed = await u.agent.post("/workspaces").set("Content-Type", "application/json").send("{not json");
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe("BAD_REQUEST");
  });
});

describe("rate limiting", () => {
  it("limits per identity per window, reports Retry-After, resets with the window, and isolates identities", async () => {
    const { db, close } = await createTestDb();
    await migrate(db);
    let now = Date.parse("2030-01-01T00:00:10Z");
    const limit = createRateLimiter(db, pino({ level: "silent" }), () => now);
    const app = express();
    app.use((req, _r, n) => { req.id = "r"; req.user = { id: String(req.header("x-user")), email: "", name: "" }; n(); });
    app.get("/x", limit({ name: "t", limit: 3, windowS: 60 }), (_q, r) => { r.json({ ok: true }); });
    const hit = (u: string) => request(app).get("/x").set("x-user", u);
    expect([(await hit("a")).status, (await hit("a")).status, (await hit("a")).status]).toEqual([200, 200, 200]);
    const blocked = await hit("a");
    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBe("50");
    expect(blocked.body.error.code).toBe("RATE_LIMITED");
    expect((await hit("b")).status).toBe(200);                       // another user is unaffected
    now += 51_000;                                                    // next window
    expect((await hit("a")).status).toBe(200);
    await close();
  });

  it("fails OPEN when the database is down (an outage must not become a second outage)", async () => {
    const limit = createRateLimiter({ query: async () => { throw new Error("db down"); } } as never, pino({ level: "silent" }));
    const app = express();
    app.get("/x", limit({ name: "t", limit: 1, windowS: 60 }), (_q, r) => { r.json({ ok: true }); });
    expect((await request(app).get("/x")).status).toBe(200);
    expect((await request(app).get("/x")).status).toBe(200);
  });

  it("protects the expensive endpoints (report requests: 10/hour)", async () => {
    const t = await createTestApp([createFakeAdapter("linkedin", () => ok()).adapter]);
    const w = await world(t, ["linkedin"]);
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await w.owner.agent.post(`/workspaces/${w.ws}/reports`).send({ type: "platform_comparison" })).status);
    expect(statuses.slice(0, 10).every((s) => s === 202)).toBe(true);
    expect(statuses[10]).toBe(429);
    await t.close();
  });
});

describe("ops endpoint", async () => {
  const token = "ops-token-ops-token-ops-token-1234";
  const t = await createTestApp([createFakeAdapter("linkedin", () => ok()).adapter], { env: { OPS_TOKEN: token } });
  const off = await createTestApp([], {});
  afterAll(async () => { await t.close(); await off.close(); });

  it("is invisible without OPS_TOKEN, requires the exact bearer token, and reports backlog", async () => {
    expect((await request(off.app).get("/health/queues")).status).toBe(404);
    expect((await request(t.app).get("/health/queues")).status).toBe(401);
    expect((await request(t.app).get("/health/queues").set("Authorization", "Bearer wrong-wrong-wrong-wrong-wrong-12")).status).toBe(401);
    const good = await request(t.app).get("/health/queues").set("Authorization", `Bearer ${token}`);
    expect(good.status).toBe(200);
    expect(good.body.data).toMatchObject({ status: "ok", outbox_due: 0, jobs_lease_expired: 0 });
    const w = await world(t, ["linkedin"]);
    await t.db.query("INSERT INTO publishing_jobs (workspace_id, post_id, variant_id, social_account_id, platform, status, lease_token, lease_until, created_by, idempotency_key) SELECT $1, $2, v.id, v.social_account_id, 'linkedin', 'processing', gen_random_uuid(), now() - interval '1 minute', $3, 'k' FROM post_variants v WHERE v.post_id = $2", [w.ws, w.post, w.owner.id]);
    const bad = await request(t.app).get("/health/queues").set("Authorization", `Bearer ${token}`);
    expect(bad.status).toBe(503);
    expect(bad.body.data).toMatchObject({ status: "degraded", jobs_lease_expired: 1 });
  });
});
