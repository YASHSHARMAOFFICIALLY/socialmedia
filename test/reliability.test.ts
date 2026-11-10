import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import type { Db, Queryable } from "../src/infrastructure/database/db.js";
import { createFakeAdapter, metricsOf, ok } from "./helpers/fake-adapter.js";
import { createTestApp } from "./helpers/app.js";
import { drain, jobs, publish, world, type T, type U } from "./helpers/world.js";

/** Db decorator: counts statements, records distinct SQL for plan checks, and can simulate outages / targeted failures. */
function instrument(inner: Db) {
  const state = { count: 0, down: false, failOn: null as RegExp | null, seen: new Map<string, readonly unknown[]>() };
  const guard = (sql: string, params?: readonly unknown[]) => {
    if (state.down) throw new Error("connection terminated unexpectedly (simulated outage) host=10.0.0.5 password=hunter2");
    if (state.failOn?.test(sql)) throw new Error("simulated failure in statement");
    state.count++;
    const key = sql.replace(/\s+/g, " ").trim();
    if (!state.seen.has(key)) state.seen.set(key, params ?? []);
  };
  const wrapQ = (q: Queryable): Queryable => ({ query: async (sql, params) => { guard(sql, params); return q.query(sql, params); } });
  const db: Db = {
    query: async (sql, params) => { guard(sql, params); return inner.query(sql, params); },
    tx: (fn) => inner.tx((q) => fn(wrapQ(q))),
    session: async () => { if (state.down) throw new Error("connection terminated unexpectedly"); return inner.session(); },
  };
  return { db, state };
}

describe("failure handling", async () => {
  let ctl!: ReturnType<typeof instrument>["state"];
  const x = createFakeAdapter("linkedin", () => ok());
  const t = await createTestApp([x.adapter], { wrapDb: (d) => { const i = instrument(d); ctl = i.state; return i.db; } });
  afterAll(t.close);

  it("a database outage yields clean 500s (no internals leaked), failing readiness, a live process, and automatic recovery", async () => {
    const u = await t.newUser("dbdown");
    expect((await u.agent.get("/workspaces")).status).toBe(200);
    ctl.down = true;
    const r = await u.agent.get("/workspaces");
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toMatch(/hunter2|10\.0\.0\.5|terminated|host=/);
    expect(r.body.error).toMatchObject({ code: "INTERNAL", message: "Internal server error" });
    expect((await request(t.app).get("/health/ready")).status).toBe(503);
    expect((await request(t.app).get("/health/live")).status).toBe(200);
    ctl.down = false;
    expect((await request(t.app).get("/health/ready")).status).toBe(200);
    expect((await u.agent.get("/workspaces")).status).toBe(200);                       // same session still valid
  });

  it("background sweeps survive a database outage without throwing, and catch up afterwards", async () => {
    const w = await world(t, ["linkedin"]);
    await publish(w.owner, w.ws, w.post);
    t.queued.length = 0;
    await t.db.query("UPDATE outbox_events SET dispatched_at = NULL");
    ctl.down = true;
    const report = await t.deps.engine.sweep();
    expect(report.errors.length).toBeGreaterThan(0);
    expect(await t.deps.engine.analytics.sweep().then((r) => r.errors.length > 0)).toBe(true);
    ctl.down = false;
    expect((await t.deps.engine.sweep()).dispatched).toBe(1);
    expect(await drain(t)).toEqual(["published"]);
  });

  it("publishing is atomic: a failure while creating the job leaves nothing behind, and the retry creates exactly one job", async () => {
    const w = await world(t, ["linkedin"]);
    ctl.failOn = /INSERT INTO outbox_events/;
    const failed = await publish(w.owner, w.ws, w.post, {}, "retry-key-12345");
    ctl.failOn = null;
    expect(failed.status).toBe(500);
    expect(await jobs(t, w.ws)).toHaveLength(0);
    expect((await t.db.query("SELECT 1 FROM idempotency_keys WHERE workspace_id = $1", [w.ws])).rowCount).toBe(0);   // the key was rolled back too
    expect((await t.db.query("SELECT status FROM posts WHERE id = $1", [w.post])).rows[0]).toEqual({ status: "draft" });
    const again = await publish(w.owner, w.ws, w.post, {}, "retry-key-12345");
    expect(again.status).toBe(202);
    expect(await jobs(t, w.ws)).toHaveLength(1);
    await drain(t);
    expect(x.calls.filter((c) => c.content.text === "Hello world").length).toBeGreaterThanOrEqual(1);
  });

  it("analytics problems cannot stop publishing (separate code path, queue and tables)", async () => {
    const w = await world(t, ["linkedin"]);
    ctl.failOn = /analytics_/;
    expect((await t.deps.engine.analytics.sweep()).errors.length).toBeGreaterThan(0);
    await publish(w.owner, w.ws, w.post);
    expect(await drain(t)).toEqual(["published"]);
    ctl.failOn = null;
  });
});

describe("query efficiency", async () => {
  const t0 = await (async () => { let st!: ReturnType<typeof instrument>["state"]; const t = await createTestApp([createFakeAdapter("linkedin", () => ok(), { postMetrics: () => metricsOf({}) }).adapter], { wrapDb: (d) => { const i = instrument(d); st = i.state; return i.db; } }); return { t, st }; })();
  const { t, st } = t0;
  afterAll(t.close);
  const queriesFor = async (u: U, url: string) => { const before = st.count; const r = await u.agent.get(url); expect(r.status, url).toBe(200); return st.count - before; };

  it("list endpoints use a constant number of queries regardless of how many rows they return (no N+1)", async () => {
    const w = await world(t, ["linkedin"]);
    const urls = [`/workspaces/${w.ws}/posts`, `/workspaces/${w.ws}/publications`, `/workspaces/${w.ws}/media`, `/workspaces/${w.ws}/accounts`, `/workspaces/${w.ws}/campaigns`, `/workspaces/${w.ws}/notifications`, `/workspaces/${w.ws}/audit-logs`, `/workspaces/${w.ws}/approval-requests`, `/workspaces/${w.ws}/members`, `/workspaces/${w.ws}/calendar?month=2030-06`];
    const small: number[] = [];
    const seed = async (n: number) => {
      for (let i = 0; i < n; i++) {
        const post = (await w.owner.agent.post(`/workspaces/${w.ws}/posts`).send({ title: `p${i}`, body: "b", variants: [{ accountId: w.accounts.linkedin }] })).body.data.id;
        const v = (await t.db.query<{ id: string }>("SELECT id FROM post_variants WHERE post_id = $1", [post])).rows[0]!.id;
        await t.db.query("INSERT INTO publishing_jobs (workspace_id, post_id, variant_id, social_account_id, platform, status, next_attempt_at, published_at, external_id, created_by, idempotency_key) VALUES ($1,$2,$3,$4,'linkedin','published','2030-06-10','2030-06-10',$5,$6,$7)", [w.ws, post, v, w.accounts.linkedin, `e${i}${Math.random()}`, w.owner.id, `k${Math.random()}`]);
        await t.db.query("INSERT INTO media_assets (workspace_id, kind, storage_key, filename, mime_type, size_bytes, status, created_by) VALUES ($1,'image',$2,'f.jpg','image/jpeg',10,'ready',$3)", [w.ws, `k${i}${Math.random()}`, w.owner.id]);
        await t.db.query("INSERT INTO notifications (workspace_id, user_id, type, title, body, ref) VALUES ($1,$2,'publish_succeeded','t','b',$3)", [w.ws, w.owner.id, `r${i}${Math.random()}`]);
        await w.owner.agent.post(`/workspaces/${w.ws}/campaigns`).send({ name: `c${i}` });
      }
    };
    await seed(3);
    for (const u of urls) small.push(await queriesFor(w.owner, u));
    await seed(27);
    const large: number[] = [];
    for (const u of urls) large.push(await queriesFor(w.owner, u));
    expect(Object.fromEntries(urls.map((u, i) => [u.replace(w.ws, ":ws"), large[i]]))).toEqual(Object.fromEntries(urls.map((u, i) => [u.replace(w.ws, ":ws"), small[i]])));
    expect((await w.owner.agent.get(`/workspaces/${w.ws}/posts?limit=100`)).body.data.length).toBeGreaterThanOrEqual(25);
  });

  it("INDEX AUDIT: every statement the application runs can be served by an index (no sequential scan of a growing table)", async () => {
    const w = await world(t, ["linkedin"]);
    const owner = w.owner;
    // exercise a broad workload so the instrumented Db sees the real statements
    for (let i = 0; i < 4; i++) await publish(owner, w.ws, (await owner.agent.post(`/workspaces/${w.ws}/posts`).send({ body: `n${i}`, variants: [{ accountId: w.accounts.linkedin }] })).body.data.id);
    await drain(t);
    for (let i = 0; i < 2; i++) { await t.deps.engine.sweep(); await t.deps.engine.analytics.sweep(); await t.deps.engine.notifications.sweep(); await t.deps.engine.reports.sweep(); }
    const camp = (await owner.agent.post(`/workspaces/${w.ws}/campaigns`).send({ name: "C" })).body.data.id;
    await owner.agent.post(`/workspaces/${w.ws}/campaigns/${camp}/posts`).send({ postIds: [w.post] });
    await owner.agent.post(`/workspaces/${w.ws}/reports`).send({ type: "post_performance" });
    await owner.agent.post(`/workspaces/${w.ws}/posts/${w.post}/approval-requests`).send({});
    await owner.agent.put(`/workspaces/${w.ws}/posts/${w.post}/variants/${w.accounts.linkedin}`).send({ caption: "c" });
    const gets = ["posts", `posts/${w.post}`, "publications", "accounts", `accounts/${w.accounts.linkedin}`, "media", "campaigns", `campaigns/${camp}`, `campaigns/${camp}/performance`, "notifications", "audit-logs", "approval-requests", "members", "invitations", "calendar?month=2030-06", "analytics/overview", "analytics/platforms/linkedin", `analytics/accounts/${w.accounts.linkedin}`, `analytics/posts/${w.post}`, "analytics/trends?metric=likes", "analytics/trends?metric=followers", "analytics/compare/platforms", "analytics/top-posts?metric=likes&platform=linkedin", "insights", "reports", "bulk/status"];
    for (const g of gets) await owner.agent.get(`/workspaces/${w.ws}/${g}`);
    await owner.agent.get(`/workspaces/${w.ws}/analytics/compare/ranges?aFrom=2030-01-01&aTo=2030-01-31&bFrom=2030-02-01&bTo=2030-02-28`);

    const GROWING = ["publishing_jobs", "publishing_attempts", "publishing_events", "outbox_events", "analytics_snapshots", "analytics_metrics", "analytics_aggregates", "analytics_targets", "notifications", "audit_logs", "posts", "post_variants", "post_media", "media_assets", "export_jobs", "approval_requests", "approvals", "campaign_posts", "idempotency_keys", "scheduled_posts"];
    // Statements that scan by design (documented): tiny reference tables or maintenance sweeps that are bounded elsewhere.
    const KNOWN: RegExp[] = [/^SELECT .* FROM workspace_members m JOIN "user"/ /* membership list of one workspace */];
    if (process.env.DROP_INDEX) for (const ix of process.env.DROP_INDEX.split(",")) await t.db.query(`DROP INDEX ${ix}`);   // negative control: DROP_INDEX=ix1,ix2 npx vitest run test/reliability.test.ts -t "INDEX AUDIT" must FAIL, proving the audit can detect a missing index
    await t.db.query("SET enable_seqscan = off");
    const offenders: string[] = [];
    let planned = 0;
    for (const [sql, params] of st.seen) {
      if (!/^(SELECT|WITH|UPDATE|DELETE)\b/i.test(sql) || /^(SET|CREATE|ALTER|SELECT pg_)/i.test(sql)) continue;
      if (KNOWN.some((k) => k.test(sql))) continue;
      let plan: unknown;
      try { plan = (await t.db.query<{ "QUERY PLAN": unknown }>(`EXPLAIN (FORMAT JSON) ${sql}`, params as unknown[])).rows[0]!["QUERY PLAN"]; } catch { continue; }   // statements that cannot be planned standalone are skipped
      planned++;
      // With sequential scans disabled the planner can only avoid an index when NONE can serve the statement, so a Seq Scan of a growing
      // table means a missing index. (This proves an index path exists, not its selectivity at production scale: see docs for load testing.)
      const walk = (n: any) => {
        if (n["Node Type"] === "Seq Scan" && GROWING.includes(n["Relation Name"])) offenders.push(`${n["Relation Name"]}: ${sql.slice(0, 160)}`);
        for (const c of n.Plans ?? []) walk(c);
      };
      for (const root of plan as any[]) walk(root.Plan);
    }
    await t.db.query("RESET enable_seqscan");
    expect(planned).toBeGreaterThan(50);                                                // plans were really produced and inspected                                           // the audit really covered the application's statements
    expect(offenders).toEqual([]);
  });
});
