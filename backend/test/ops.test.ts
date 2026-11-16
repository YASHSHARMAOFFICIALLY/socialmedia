import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import type { Db } from "../src/infrastructure/database/db.js";
import { quantile, routeGroup } from "../src/modules/ops/metrics.js";
import { estimateMonthlyCosts } from "../src/modules/ops/costs.js";
import { purgeOldRows } from "../src/workers/maintenance.js";
import { createTestApp } from "./helpers/app.js";
import { world } from "./helpers/world.js";

const OPS = "ops-token-ops-token-ops-token-123";

describe("route groups", () => {
  it("collapse matched route patterns to a bounded set of groups", () => {
    expect(routeGroup("/workspaces/:workspaceId/posts/:postId/publish", "/workspaces/abc/posts/def/publish")).toBe("/workspaces/:workspaceId/posts");
    expect(routeGroup("/api/auth/*splat", "/api/auth/sign-in/email")).toBe("/api/auth");
    expect(routeGroup("/health/live", "/health/live")).toBe("/health/live");
    expect(routeGroup(undefined, "/admin/ops/overview")).toBe("/admin");   // rejected by router-level middleware before a route matched
    expect(routeGroup(undefined, "/wp-login.php")).toBe("unmatched");        // scanners never create new groups
    expect(routeGroup(undefined, "/x".repeat(50))).toBe("unmatched");
  });
});

describe("latency quantiles from histogram buckets", () => {
  it("interpolate inside the bucket that holds the quantile", () => {
    const b = [{ le: 10, count: 50 }, { le: 25, count: 50 }];   // buckets (5,10] and (10,25]
    expect(quantile(b, 0.5)).toBe(10);
    expect(quantile(b, 0.75)).toBe(17.5);   // halfway through (10, 25]
    expect(quantile(b, 0.99)).toBeCloseTo(24.7);
    expect(quantile([], 0.5)).toBeNull();
  });
  it("the overflow bucket reports its lower bound, never a fake number", () => {
    expect(quantile([{ le: 30000, count: 1 }, { le: 2147483647, count: 99 }], 0.99)).toBe(30000);
  });
});

describe("cost estimate", () => {
  it("bills only usage above the included allowances", () => {
    const low = estimateMonthlyCosts({ requestsPerMonth: 1_000_000, dbBytes: 100e6, r2Bytes: 1e9 });
    expect(low.totalUsd).toBe(5);   // Workers Paid base only
    const high = estimateMonthlyCosts({ requestsPerMonth: 20_000_000, dbBytes: 100e6, r2Bytes: 20e9 });
    expect(high.items.find((i) => i.key === "workers_requests")!.usd).toBeCloseTo(3);      // 10M over x $0.30/M
    expect(high.items.find((i) => i.key === "r2_storage")!.usd).toBeCloseTo(0.15);        // 10 GB over x $0.015
  });
});

describe("ops dashboard backend", async () => {
  let boom = false;
  const wrapDb = (db: Db): Db => ({ ...db, query: (t, p) => (boom && t.includes("FROM audit_logs") && t.includes("workspace_id = $1") ? Promise.reject(new Error("db exploded for owner@example.com token=abc123def456ghi789")) : db.query(t, p)) });
  const t = await createTestApp([], { env: { OPS_TOKEN: OPS, CORS_ORIGINS: "https://dash.example" }, wrapDb });
  afterAll(t.close);
  const ops = (path: string, token: string | null = OPS) => { const r = request(t.app).get(path); return token ? r.set("authorization", `Bearer ${token}`) : r; };
  const metrics = t.deps.metrics!;

  it("aggregates requests per minute x route group x status x latency bucket, one upsert per flush", async () => {
    await t.db.query("DELETE FROM request_metrics");
    for (let i = 0; i < 3; i++) await request(t.app).get("/health/live");
    await request(t.app).get("/does-not-exist");
    await metrics.flush();
    const rows = (await t.db.query<{ route_group: string; status: number; n: number }>("SELECT route_group, status, sum(count)::int AS n FROM request_metrics GROUP BY 1,2 ORDER BY 1")).rows;
    expect(rows).toEqual([{ route_group: "/health/live", status: 200, n: 3 }, { route_group: "unmatched", status: 404, n: 1 }]);
    // a later flush adds to the same minute's row instead of inserting duplicates (fixed latency: same bucket every time)
    const minute = () => Math.floor(Date.now() / 60_000);
    const m0 = minute();
    metrics.record("/t", 200, 3); metrics.record("/t", 200, 4);
    await metrics.flush();
    metrics.record("/t", 200, 2);
    await metrics.flush();
    const live = (await t.db.query<{ n: number; rows: number; ms: number }>("SELECT sum(count)::int AS n, count(*)::int AS rows, sum(sum_ms)::int AS ms FROM request_metrics WHERE route_group = '/t'")).rows[0]!;
    expect(live).toEqual({ n: 3, ms: 9, rows: minute() - m0 + 1 });   // one row unless the test straddled a minute boundary
    await metrics.flush();   // nothing buffered: no write, no error
  });

  it("persists unhandled errors with route and request id, redacting emails and tokens", async () => {
    const { owner, ws } = await world(t, []);
    boom = true;
    const r = await owner.agent.get(`/workspaces/${ws}/audit-logs`);
    boom = false;
    expect(r.status).toBe(500);
    await metrics.flush();
    const e = (await t.db.query<{ source: string; route: string; method: string; request_id: string; message: string }>("SELECT source, route, method, request_id, message FROM server_errors ORDER BY id DESC LIMIT 1")).rows[0]!;
    expect(e).toMatchObject({ source: "http", route: `/workspaces/${ws}/audit-logs`, method: "GET", request_id: r.headers["x-request-id"] });
    expect(e.message).not.toContain("owner@example.com");
    expect(e.message).not.toContain("abc123def456ghi789");
    expect(e.message).toContain("db exploded");
    // ...and it shows up in the error-rate metrics
    expect((await t.db.query("SELECT 1 FROM request_metrics WHERE route_group = '/workspaces/:workspaceId/audit-logs' AND status = 500")).rowCount).toBe(1);
  });

  it("every /admin/ops endpoint requires the ops token (constant-time), and is 404 when no token is configured", async () => {
    for (const p of ["/admin/ops/overview", "/admin/ops/metrics", "/admin/ops/audit", "/admin/ops/errors"]) {
      expect((await ops(p, null)).status).toBe(401);
      expect((await ops(p, "wrong-token-wrong-token-wrong")).status).toBe(401);
    }
    const { owner } = await world(t, []);
    expect((await owner.agent.get("/admin/ops/overview")).status).toBe(401);   // a user session is not an operator
    const off = await createTestApp([]);
    expect((await request(off.app).get("/admin/ops/overview").set("authorization", `Bearer ${OPS}`)).status).toBe(404);
    await off.close();
  });

  it("CORS preflight from the dashboard origin allows the Authorization header", async () => {
    const r = await request(t.app).options("/admin/ops/overview").set("Origin", "https://dash.example").set("Access-Control-Request-Method", "GET").set("Access-Control-Request-Headers", "authorization");
    expect(r.status).toBe(204);
    expect(r.headers["access-control-allow-origin"]).toBe("https://dash.example");
    expect(r.headers["access-control-allow-headers"]).toMatch(/authorization/i);
  });

  it("overview: status, database, queues, business, storage, costs from real tables", async () => {
    const { ws, owner } = await world(t, ["linkedin"]);
    await t.db.query("INSERT INTO media_assets (workspace_id, kind, storage_key, filename, mime_type, size_bytes, status, created_by) VALUES ($1,'image','k1','a.png','image/png',1000,'ready',$2), ($1,'image','k2','b.png','image/png',500,'deleted',$2)", [ws, owner.id]);
    metrics.deadLettered("publish-jobs-dlq", [{ body: { jobId: "j1" }, attempts: 6 }, { body: { jobId: "j2" }, attempts: 6 }]);
    await metrics.flush();
    const r = await ops("/admin/ops/overview");
    expect(r.status).toBe(200);
    const d = r.body.data;
    expect(d.status.api).toBe("up");
    expect(d.status.db.ok).toBe(true);
    expect(typeof d.status.db.latencyMs).toBe("number");
    expect(d.database.sizeBytes).toBeGreaterThan(0);
    expect(d.database.planLimitBytes).toBe(1024 * 1024 * 1024);   // PGlite has no neon.max_cluster_size: plan constant
    expect(d.database.tables.length).toBeGreaterThan(0);
    expect(d.database.tables[0]).toEqual(expect.objectContaining({ name: expect.any(String), totalBytes: expect.any(Number), rows: expect.any(Number) }));
    expect(d.queues.dlq).toEqual(expect.arrayContaining([{ queue: "publish-jobs-dlq", last24h: 2, last7d: 2 }]));
    expect(d.queues.jobs).toEqual(expect.objectContaining({ pending: expect.any(Number), failed24h: expect.any(Number) }));
    expect(d.business.users).toBeGreaterThan(0);
    expect(d.business.accountsByPlatform).toEqual(expect.arrayContaining([expect.objectContaining({ platform: "linkedin", active: expect.any(Number) })]));
    expect(d.storage.trackedBytes).toBeGreaterThanOrEqual(1000);
    expect(d.costs.estimate).toBe(true);
    expect(d.costs.totalUsd).toBeGreaterThanOrEqual(5);
  });

  it("metrics: per-group count, error rate and latency percentiles plus a time series, for 1h/24h/7d", async () => {
    await t.db.query("DELETE FROM request_metrics");
    await t.db.query(`INSERT INTO request_metrics (minute, route_group, status, le_ms, count, sum_ms) VALUES
      (date_trunc('minute', now()), '/api/auth', 200, 10, 90, 450), (date_trunc('minute', now()), '/api/auth', 500, 100, 10, 800),
      (date_trunc('minute', now()) - interval '2 hours', '/api/auth', 200, 10, 7, 35)`);
    const h = (await ops("/admin/ops/metrics?range=1h")).body.data;
    const g = h.groups.find((x: { group: string }) => x.group === "/api/auth");
    expect(g).toMatchObject({ count: 100, errors5xx: 10, errorRate: 0.1 });
    expect(g.p50).toBeLessThanOrEqual(10);
    expect(g.p99).toBeGreaterThan(10);
    expect(h.series.reduce((s: number, p: { count: number }) => s + p.count, 0)).toBe(100);
    expect(h.totals).toMatchObject({ count: 100, errors5xx: 10 });
    expect((await ops("/admin/ops/metrics?range=24h")).body.data.totals.count).toBe(107);
    expect((await ops("/admin/ops/metrics?range=1y")).status).toBe(400);
  });

  it("audit: newest first, filter by workspace and action prefix, keyset pagination", async () => {
    const a = await world(t, []), b = await world(t, []);
    for (const [ws, action] of [[a.ws, "zz.created"], [a.ws, "zz.deleted"], [b.ws, "zz.created"], [a.ws, "yy.invited"]] as const)
      await t.db.query("INSERT INTO audit_logs (workspace_id, actor_id, action, entity_type, entity_id) VALUES ($1,$2,$3,'post','x')", [ws, a.owner.id, action]);
    const p1 = (await ops(`/admin/ops/audit?workspaceId=${a.ws}&action=zz.&limit=1`)).body;
    expect(p1.data).toHaveLength(1);
    expect(p1.data[0]).toMatchObject({ action: "zz.deleted", workspaceId: a.ws, actorEmail: a.owner.email });
    const p2 = (await ops(`/admin/ops/audit?workspaceId=${a.ws}&action=zz.&limit=1&before=${p1.meta.nextBefore}`)).body;
    expect(p2.data.map((x: { action: string }) => x.action)).toEqual(["zz.created"]);
    expect(p2.meta.nextBefore).toBeNull();
    expect((await ops("/admin/ops/audit?action=100%25")).status).toBe(200);   // LIKE metacharacters are literal
  });

  it("errors: newest first, paginated, filterable by source", async () => {
    const r = (await ops("/admin/ops/errors?source=dlq&limit=1")).body;
    expect(r.data[0]).toMatchObject({ source: "dlq", route: "publish-jobs-dlq" });
    expect(r.meta.nextBefore).not.toBeNull();
  });

  it("housekeeping prunes metrics and errors older than 30 days", async () => {
    await t.db.query("INSERT INTO request_metrics (minute, route_group, status, le_ms, count, sum_ms) VALUES (now() - interval '31 days', 'old', 200, 10, 1, 1)");
    await t.db.query("INSERT INTO server_errors (source, route, message, created_at) VALUES ('http', '/old', 'x', now() - interval '31 days')");
    const out = await purgeOldRows(t.db);
    expect(out).toMatchObject({ requestMetrics: 1, serverErrors: 1 });
    expect((await t.db.query("SELECT 1 FROM request_metrics WHERE route_group = 'old'")).rowCount).toBe(0);
    expect((await t.db.query("SELECT 1 FROM server_errors")).rowCount).toBeGreaterThan(0);   // recent rows stay
  });

  it("a failed flush never breaks requests", async () => {
    const broken = await createTestApp([], { wrapDb: (db) => ({ ...db, query: (q, p) => (q.includes("request_metrics") ? Promise.reject(new Error("down")) : db.query(q, p)) }) });
    expect((await request(broken.app).get("/health/live")).status).toBe(200);
    await expect(broken.deps.metrics!.flush()).resolves.toBeUndefined();
    await broken.close();
  });
});
