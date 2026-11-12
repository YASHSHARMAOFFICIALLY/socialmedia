import { describe, it, expect, afterAll } from "vitest";
import { cell, toCsv } from "../src/modules/reports/csv.js";
import { toPdf } from "../src/modules/reports/pdf.js";
import { createFakeAdapter, metricsOf, ok } from "./helpers/fake-adapter.js";
import { createTestApp } from "./helpers/app.js";
import { world, type T, type U } from "./helpers/world.js";

describe("CSV writer", () => {
  it("quotes per RFC 4180, writes empty for unavailable, keeps numbers numeric", () => {
    expect(toCsv(["a", "b"], [["x,y", 'he said "hi"'], ["line\nbreak", null], [0, undefined]])).toBe('a,b\r\n"x,y","he said ""hi"""\r\n"line\nbreak",\r\n0,\r\n');
    expect(cell(0)).toBe("0");
    expect(cell(null)).toBe("");
    expect(cell(Number.NaN)).toBe("");
  });
  it("neutralizes spreadsheet formula injection in text but never touches numbers", () => {
    expect(cell("=HYPERLINK(\"http://evil\")")).toBe(`"'=HYPERLINK(""http://evil"")"`);
    for (const s of ["+1+1", "-2+3", "@SUM(A1)", "\tcmd", "\rcmd"]) expect(cell(s).replace(/^"|"$/g, "").startsWith("'")).toBe(true);
    expect(cell(-5)).toBe("-5");
    expect(cell("normal text")).toBe("normal text");
  });
});

describe("PDF writer", () => {
  const structure = (buf: Buffer) => {
    const s = buf.toString("latin1");
    const start = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(s)![1]);
    expect(s.slice(start, start + 4)).toBe("xref");
    const size = Number(/\/Size (\d+)/.exec(s)![1]);
    const entries = [...s.slice(start).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
    expect(entries).toHaveLength(size - 1);
    entries.forEach((off, i) => expect(s.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));   // every xref offset points at its object
    return { s, pages: Number(/\/Count (\d+)/.exec(s)![1]) };
  };
  it("produces a structurally valid, paginated PDF with correct cross-reference offsets", () => {
    const rows = Array.from({ length: 120 }, (_, i) => [`row ${i}`, i, i % 2 === 0, null]);
    const { s, pages } = structure(toPdf("Report", "sub", ["name", "n", "flag", "empty"], rows));
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(pages).toBe(3);                                                            // 120 rows over several landscape pages
    expect(s).toContain("(Page 1 of 3");
    expect(s).toContain("(row 119)");
    expect(structure(toPdf("Empty", "s", ["a"], [])).pages).toBe(1);                // header-only report still renders
  });
  it("escapes PDF syntax characters, replaces unsupported characters, truncates overlong cells", () => {
    const { s } = structure(toPdf("T", "s", ["a", "b"], [["(evil) \\ )", "日本語 ok"], ["x".repeat(500), "y"]]));
    expect(s).toContain("\\(evil\\) \\\\ \\)");
    expect(s).toContain("??? ok");
    expect(s).not.toContain("x".repeat(200));   // 500 chars cannot fit a column: truncated, never overflowing into the next one
  });
});

describe("report exports", async () => {
  const x = createFakeAdapter("x", () => ok(), { postMetrics: (_n: number, id: string) => metricsOf({ "public_metrics.like_count": id === "p1" ? 10 : 30, "public_metrics.impression_count": 1000, "public_metrics.reply_count": id === "p2" ? null : 2 }), accountMetrics: () => metricsOf({ "public_metrics.followers_count": 500 }) });
  const t: T = await createTestApp([x.adapter]);
  afterAll(t.close);
  const iso = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
  async function published(ws: string, owner: U, accountId: string, externalId: string, title: string) {
    const post = (await owner.agent.post(`/workspaces/${ws}/posts`).send({ title, body: title, variants: [{ accountId }] })).body.data.id as string;
    const v = (await t.db.query<{ id: string }>("SELECT id FROM post_variants WHERE post_id = $1", [post])).rows[0]!.id;
    await t.db.query("INSERT INTO publishing_jobs (workspace_id, post_id, variant_id, social_account_id, platform, status, next_attempt_at, published_at, external_id, external_url, created_by, idempotency_key) VALUES ($1,$2,$3,$4,'x','published',$5,$5,$6,$7,$8,$9)", [ws, post, v, accountId, iso(2), externalId, `https://x.com/i/${externalId}`, owner.id, `k${Math.random()}`]);
    return post;
  }
  const collect = async () => { await t.deps.engine.analytics.sweep(); while (t.analyticsQueued.length) await t.deps.engine.analytics.collect(t.analyticsQueued.shift()!); };
  const request = (u: U, ws: string, body: object) => u.agent.post(`/workspaces/${ws}/reports`).send(body);
  const csvOf = async (u: U, ws: string, id: string) => (await u.agent.get(`/workspaces/${ws}/reports/${id}/download`));
  const parse = (csv: string) => csv.trim().split("\r\n").map((l) => l.split(","));

  it("post_performance: async lifecycle, one row per published destination, blanks for unavailable, never zeros", async () => {
    const w = await world(t, ["x"]);
    const camp = (await w.owner.agent.post(`/workspaces/${w.ws}/campaigns`).send({ name: "Camp" })).body.data.id;
    const p1 = await published(w.ws, w.owner, w.accounts.x!, "p1", "First");
    await published(w.ws, w.owner, w.accounts.x!, "p2", "Second, with comma");
    await w.owner.agent.post(`/workspaces/${w.ws}/campaigns/${camp}/posts`).send({ postIds: [p1] });
    await collect();
    const job = await request(w.owner, w.ws, { type: "post_performance" });
    expect(job.status).toBe(202);
    expect(job.body.data.status).toBe("queued");
    expect((await csvOf(w.owner, w.ws, job.body.data.id)).body.error.code).toBe("REPORT_NOT_READY");
    expect(await t.deps.engine.reports.sweep()).toEqual({ claimed: 1, done: 1 });
    const st = (await w.owner.agent.get(`/workspaces/${w.ws}/reports/${job.body.data.id}`)).body.data;
    expect(st).toMatchObject({ status: "done", rows: 2, downloadable: true });
    const res = await csvOf(w.owner, w.ws, job.body.data.id);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="post_performance-/);
    expect(res.headers["cache-control"]).toBe("no-store");
    const rows = res.text.trim().split("\r\n");
    const header = rows[0]!.split(",");
    const col = (name: string) => header.indexOf(name);
    const first = rows.find((r) => r.includes("First"))!.split(","), second = rows.find((r) => r.includes("Second"))!;
    expect(first[col("likes")]).toBe("10");
    expect(first[col("impressions")]).toBe("1000");
    expect(first[col("interactions")]).toBe("12");
    expect(first[col("engagement_rate")]).toBe("0.012");
    expect(first[col("engagement_rate_denominator")]).toBe("impressions");
    expect(first[col("views")]).toBe("");                         // X reports no views: empty, not 0
    expect(second).toContain('"Second, with comma"');
    const sp = second.replace('"Second, with comma"', "Second").split(",");
    expect(sp[col("comments")]).toBe("");                         // reported unavailable: empty
    expect(sp[col("likes")]).toBe("30");
    // campaign filter
    const filtered = await request(w.owner, w.ws, { type: "post_performance", campaignId: camp });
    await t.deps.engine.reports.sweep();
    expect(parse((await csvOf(w.owner, w.ws, filtered.body.data.id)).text)).toHaveLength(2);
  });

  it("every report type produces a well-formed CSV that matches the dashboard semantics", async () => {
    const w = await world(t, ["x"]);
    await published(w.ws, w.owner, w.accounts.x!, "p1", "A");
    await collect();
    const ids: Record<string, string> = {};
    for (const type of ["account_performance", "campaign_analytics", "platform_comparison", "historical_performance"]) ids[type] = (await request(w.owner, w.ws, { type })).body.data.id;
    await t.deps.engine.reports.sweep(); await t.deps.engine.reports.sweep();
    const get = async (type: string) => parse((await csvOf(w.owner, w.ws, ids[type]!)).text);
    const acct = await get("account_performance");
    expect(acct[0]).toContain("followers_latest");
    expect(acct[1]!.slice(0, 4)).toEqual(["x", "acct", "active", "500"]);
    const cmp = await get("platform_comparison");
    expect(cmp.find((r) => r[1] === "likes")).toEqual(["x", "likes", "10", "1", "0", "yes"]);
    expect(cmp.find((r) => r[1] === "impressions")![5]).toBe("no");             // not comparable across platforms
    expect(cmp.find((r) => r[1] === "followers")![2]).toBe("500");
    const hist = await get("historical_performance");
    expect(hist[0]).toEqual(["period_start", "platform", "metric", "kind", "value", "partial"]);
    expect(hist.some((r) => r[2] === "followers" && r[3] === "level" && r[4] === "500")).toBe(true);
    const camp = await get("campaign_analytics");
    expect(camp).toHaveLength(1);                                                // header only: no campaigns yet, no invented rows
  });

  it("PDF exports: same pipeline, application/pdf download, row cap, format validation", async () => {
    const w = await world(t, ["x"]);
    await published(w.ws, w.owner, w.accounts.x!, "p1", "Pdf post");
    await collect();
    const job = await request(w.owner, w.ws, { type: "platform_comparison", format: "pdf" });
    expect(job.status).toBe(202);
    expect(job.body.data.format).toBe("pdf");
    await t.deps.engine.reports.sweep();
    const res = await w.owner.agent.get(`/workspaces/${w.ws}/reports/${job.body.data.id}/download`).buffer(true).parse((r, cb) => { const c: Buffer[] = []; r.on("data", (d: Buffer) => c.push(d)); r.on("end", () => cb(null, Buffer.concat(c))); });
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toMatch(/\.pdf"/);
    expect((res.body as Buffer).subarray(0, 8).toString()).toBe("%PDF-1.4");
    expect((res.body as Buffer).toString("latin1")).toContain("(likes)");
    const same = await request(w.owner, w.ws, { type: "platform_comparison" });
    await t.deps.engine.reports.sweep();
    expect((await csvOf(w.owner, w.ws, same.body.data.id)).headers["content-type"]).toMatch(/text\/csv/);   // csv path unchanged
  });

  it("CSV injection: a post titled like a formula is exported as inert text", async () => {
    const w = await world(t, ["x"]);
    await published(w.ws, w.owner, w.accounts.x!, "p1", '=HYPERLINK("http://evil","x")');
    await collect();
    const id = (await request(w.owner, w.ws, { type: "post_performance" })).body.data.id;
    await t.deps.engine.reports.sweep();
    const text = (await csvOf(w.owner, w.ws, id)).text;
    expect(text).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(text).not.toMatch(/(^|,)=HYPERLINK/m);
  });

  it("permissions, tenancy, validation, expiry and failure handling", async () => {
    const w = await world(t, ["x"]);
    await published(w.ws, w.owner, w.accounts.x!, "p1", "A");
    const id = (await request(w.owner, w.ws, { type: "platform_comparison" })).body.data.id;
    await t.deps.engine.reports.sweep();
    const add = async (role: string) => { const u = await t.newUser(role); await t.db.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,$3)", [w.ws, u.id, role]); return u; };
    const viewer = await add("viewer"), analyst = await add("analyst"), stranger = await t.newUser("s");
    expect((await request(viewer, w.ws, { type: "platform_comparison" })).status).toBe(403);
    expect((await viewer.agent.get(`/workspaces/${w.ws}/reports/${id}/download`)).status).toBe(403);
    expect((await csvOf(analyst, w.ws, id)).status).toBe(200);
    for (const r of [await request(stranger, w.ws, { type: "platform_comparison" }), await stranger.agent.get(`/workspaces/${w.ws}/reports`), await csvOf(stranger, w.ws, id)]) expect(r.status).toBe(404);
    const other = await world(t, ["x"]);
    expect((await csvOf(other.owner, other.ws, id)).status).toBe(404);              // another workspace's export id
    expect((await request(w.owner, w.ws, { type: "nope" })).status).toBe(400);
    expect((await request(w.owner, w.ws, { type: "platform_comparison", format: "docx" })).status).toBe(400);
    expect((await request(w.owner, w.ws, { type: "platform_comparison", from: "2030-02-01", to: "2030-01-01" })).status).toBe(400);
    expect((await request(w.owner, w.ws, { type: "campaign_analytics", campaignId: "00000000-0000-4000-8000-000000000000" })).status).toBe(404);
    await t.db.query("UPDATE export_jobs SET expires_at = now() - interval '1 day' WHERE id = $1", [id]);
    expect((await csvOf(w.owner, w.ws, id)).status).toBe(410);
    expect(await t.deps.engine.reports.purgeExpired()).toBeGreaterThanOrEqual(1);
    // a failing generator marks only that export failed, with a safe message
    const bad = (await request(w.owner, w.ws, { type: "platform_comparison" })).body.data.id;
    await t.db.query("UPDATE export_jobs SET type = 'corrupted' WHERE id = $1", [bad]);
    const good = (await request(w.owner, w.ws, { type: "platform_comparison" })).body.data.id;
    await t.deps.engine.reports.sweep();
    expect((await w.owner.agent.get(`/workspaces/${w.ws}/reports/${bad}`)).body.data).toMatchObject({ status: "failed", error: "The report could not be generated" });
    expect((await w.owner.agent.get(`/workspaces/${w.ws}/reports/${good}`)).body.data.status).toBe("done");
    const list = await w.owner.agent.get(`/workspaces/${w.ws}/reports?limit=1`);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.meta.nextCursor).toBeTruthy();
  });
});
