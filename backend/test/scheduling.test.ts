import { describe, it, expect, afterAll } from "vitest";
import { createFakeAdapter, ok } from "./helpers/fake-adapter.js";
import { createTestApp } from "./helpers/app.js";
import { resolveWhen } from "../src/modules/scheduling/scheduling.service.js";
import { drain, jobs, seedAccount, world, type T, type U } from "./helpers/world.js";

const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const schedule = (u: U, ws: string, post: string, body: object) => u.agent.post(`/workspaces/${ws}/posts/${post}/schedule`).send(body);
/** Fast-forward: make everything scheduled for this workspace due now (the DB, not Redis, is the clock). */
const fastForward = async (t: T) => {
  await t.db.query("UPDATE publishing_jobs SET next_attempt_at = now() - interval '1 second' WHERE status = 'scheduled'");
  await t.db.query("UPDATE outbox_events SET available_at = now() - interval '1 second' WHERE dispatched_at IS NULL");
};
const newPost = async (u: U, ws: string, accountId: string, body = "post") => (await u.agent.post(`/workspaces/${ws}/posts`).send({ body, variants: [{ accountId }] })).body.data.id as string;

describe("scheduling", async () => {
  const closers: (() => Promise<void>)[] = [];
  afterAll(async () => { for (const c of closers) await c(); });
  const mk = async () => {
    const li = createFakeAdapter("linkedin", () => ok("li-1"));
    const t = await createTestApp([li.adapter]);
    closers.push(t.close);
    return { t, li };
  };

  it("schedules for later: nothing is queued early; when due the sweeper releases it and it publishes once", async () => {
    const { t, li } = await mk();
    const { owner, ws, post } = await world(t);
    const r = await schedule(owner, ws, post, { scheduledAt: inHours(2), timezone: "Asia/Kolkata" });
    expect(r.status).toBe(202);
    expect(r.body.data.jobs[0].status).toBe("scheduled");
    expect(t.queued).toHaveLength(0);
    await t.deps.engine.sweep();
    expect(t.queued).toHaveLength(0);                                            // not due yet
    const st = (await owner.agent.get(`/workspaces/${ws}/posts/${post}/schedule`)).body.data;
    expect(st).toMatchObject({ state: "scheduled", timezone: "Asia/Kolkata", pendingDestinations: 1 });
    await fastForward(t);
    expect((await t.deps.engine.sweep()).dispatched).toBe(1);
    expect(await drain(t)).toEqual(["published"]);
    expect(li.calls).toHaveLength(1);
    expect((await owner.agent.get(`/workspaces/${ws}/posts/${post}/schedule`)).body.data.state).toBe("fired");
  });

  it("survives a total queue loss: the schedule lives in Postgres, so the sweep still fires it", async () => {
    const { t, li } = await mk();
    const { owner, ws, post } = await world(t);
    await schedule(owner, ws, post, { scheduledAt: inHours(1) });
    t.queued.length = 0;                                                          // pretend every queue/worker state vanished
    await fastForward(t);
    await t.deps.engine.sweep();
    expect(await drain(t)).toEqual(["published"]);
    expect(li.calls).toHaveLength(1);
  });

  it("is timezone aware: local wall-clock time converts to the right instant; DST gaps are rejected, overlaps flagged", async () => {
    const { t } = await mk();
    const { owner, ws, post } = await world(t);
    const nextYear = new Date().getUTCFullYear() + 1;
    const r = await schedule(owner, ws, post, { localDateTime: `${nextYear}-01-15T09:00`, timezone: "America/New_York" });
    expect(r.body.data.scheduledAt).toBe(`${nextYear}-01-15T14:00:00.000Z`);
    expect((await owner.agent.get(`/workspaces/${ws}/posts/${post}/schedule`)).body.data.localTime).toBe(`${nextYear}-01-15T09:00:00`);
    // DST gap (US clocks jump 02:00 -> 03:00 on 2030-03-10) and overlap (01:30 happens twice on 2030-11-03)
    const base = new Date("2030-01-01T00:00:00Z");
    expect(() => resolveWhen({ localDateTime: "2030-03-10T02:30", timezone: "America/New_York" }, base)).toThrow(/does not exist/);
    expect(resolveWhen({ localDateTime: "2030-03-10T03:30", timezone: "America/New_York" }, base).at.toISOString()).toBe("2030-03-10T07:30:00.000Z");
    const overlap = resolveWhen({ localDateTime: "2030-11-03T01:30", timezone: "America/New_York" }, base);
    expect(overlap.ambiguous).toBe(true);
    expect(overlap.at.toISOString()).toBe("2030-11-03T05:30:00.000Z");
  });

  it("validates times: past, too far ahead, bad zone, ambiguous input shapes", async () => {
    const { t } = await mk();
    const { owner, ws, post } = await world(t);
    const bad = async (b: object) => (await schedule(owner, ws, post, b)).status;
    expect(await bad({ scheduledAt: new Date(Date.now() - 3600_000).toISOString() })).toBe(400);
    expect(await bad({ scheduledAt: new Date(Date.now() + 10_000).toISOString() })).toBe(400);              // < 1 minute lead
    expect(await bad({ scheduledAt: new Date(Date.now() + 400 * 86400_000).toISOString() })).toBe(400);
    expect(await bad({ scheduledAt: inHours(1), timezone: "Mars/Base" })).toBe(400);
    expect(await bad({ scheduledAt: inHours(1), localDateTime: "2030-01-01T10:00" })).toBe(400);
    expect(await bad({})).toBe(400);
    expect(await bad({ scheduledAt: "tomorrow" })).toBe(400);
    expect(await jobs(t, ws)).toHaveLength(0);                                                                 // nothing leaked from failed attempts
  });

  it("detects scheduling conflicts on the same account (override allowed)", async () => {
    const { t } = await mk();
    const { owner, ws, post, accounts } = await world(t);
    const at = Date.now() + 3 * 3600_000;
    expect((await schedule(owner, ws, post, { scheduledAt: new Date(at).toISOString() })).status).toBe(202);
    const p2 = await newPost(owner, ws, accounts.linkedin!);
    const clash = await schedule(owner, ws, p2, { scheduledAt: new Date(at + 3 * 60_000).toISOString() });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe("SCHEDULE_CONFLICT");
    expect(clash.body.error.details.conflicts).toHaveLength(1);
    expect((await schedule(owner, ws, p2, { scheduledAt: new Date(at + 10 * 60_000).toISOString() })).status).toBe(202);
    const p3 = await newPost(owner, ws, accounts.linkedin!);
    expect((await schedule(owner, ws, p3, { scheduledAt: new Date(at + 11 * 60_000).toISOString(), allowConflicts: true })).status).toBe(202);
  });

  it("reschedules: destinations move, the old release time is gone, rescheduling a due/unscheduled post is refused", async () => {
    const { t } = await mk();
    const { owner, ws, post } = await world(t);
    await schedule(owner, ws, post, { scheduledAt: inHours(1) });
    const later = inHours(5);
    const r = await owner.agent.put(`/workspaces/${ws}/posts/${post}/schedule`).send({ scheduledAt: later, timezone: "Europe/Paris" });
    expect(r.status).toBe(200);
    const pending = (await t.db.query<{ available_at: string }>("SELECT available_at FROM outbox_events WHERE dispatched_at IS NULL")).rows;
    expect(pending).toHaveLength(1);                                                         // the old event was dropped, not duplicated
    expect(new Date(pending[0]!.available_at).toISOString()).toBe(later);
    expect(new Date((await t.db.query<{ n: string }>("SELECT next_attempt_at AS n FROM publishing_jobs")).rows[0]!.n).toISOString()).toBe(later);
    expect((await owner.agent.get(`/workspaces/${ws}/posts/${post}/schedule`)).body.data.timezone).toBe("Europe/Paris");
    expect((await t.deps.engine.sweep()).dispatched).toBe(0);                                 // the old time (1h) never fires
    await fastForward(t);
    await t.deps.engine.sweep(); await drain(t);
    const again = await owner.agent.put(`/workspaces/${ws}/posts/${post}/schedule`).send({ scheduledAt: inHours(9) });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("NOT_SCHEDULED");
  });

  it("cancels a schedule: nothing publishes, the post returns to an editable draft, and it can be scheduled again", async () => {
    const { t, li } = await mk();
    const { owner, ws, post } = await world(t);
    await schedule(owner, ws, post, { scheduledAt: inHours(1) });
    expect((await owner.agent.patch(`/workspaces/${ws}/posts/${post}`).send({ body: "x" })).status).toBe(409);    // locked while scheduled
    const c = await owner.agent.delete(`/workspaces/${ws}/posts/${post}/schedule`);
    expect(c.body.data.cancelled).toBe(1);
    expect((await t.db.query("SELECT 1 FROM outbox_events WHERE dispatched_at IS NULL")).rowCount).toBe(0);
    expect((await owner.agent.get(`/workspaces/${ws}/posts/${post}/schedule`)).body.data.state).toBe("cancelled");
    expect((await owner.agent.patch(`/workspaces/${ws}/posts/${post}`).send({ body: "edited" })).status).toBe(200);
    await fastForward(t); await t.deps.engine.sweep(); await drain(t);
    expect(li.calls).toHaveLength(0);
    expect((await owner.agent.delete(`/workspaces/${ws}/posts/${post}/schedule`)).status).toBe(409);
    expect((await schedule(owner, ws, post, { scheduledAt: inHours(2) })).status).toBe(202);
  });

  it("missed-job recovery: after an outage, slightly late posts still go out, but ones many hours late are NOT silently published", async () => {
    const { t, li } = await mk();
    const w = await world(t);
    const p2 = await newPost(w.owner, w.ws, w.accounts.linkedin!, "stale");
    await schedule(w.owner, w.ws, w.post, { scheduledAt: inHours(1) });
    await schedule(w.owner, w.ws, p2, { scheduledAt: inHours(3) });
    const [late, stale] = [w.post, p2];
    await t.db.query("UPDATE publishing_jobs SET next_attempt_at = now() - interval '30 minutes' WHERE post_id = $1", [late]);
    await t.db.query("UPDATE publishing_jobs SET next_attempt_at = now() - interval '8 hours' WHERE post_id = $1", [stale]);
    await t.db.query("UPDATE outbox_events SET available_at = now() - interval '1 second'");
    const rep = await t.deps.engine.sweep();
    expect(rep.missed).toBe(1);
    await drain(t);
    expect(li.calls.map((c) => c.content.text)).toEqual(["Hello world"]);                      // only the 30-minute-late one published
    const staleJob = (await t.db.query<{ status: string; failure_kind: string }>("SELECT status, failure_kind FROM publishing_jobs WHERE post_id = $1", [stale])).rows[0]!;
    expect(staleJob).toEqual({ status: "failed", failure_kind: "missed" });
    // the owner can still choose to publish it now
    const id = (await t.db.query<{ id: string }>("SELECT id FROM publishing_jobs WHERE post_id = $1", [stale])).rows[0]!.id;
    expect((await w.owner.agent.post(`/workspaces/${w.ws}/publications/${id}/retry`)).status).toBe(202);
    await drain(t);
    expect(li.calls).toHaveLength(2);
  });

  it("RBAC and isolation", async () => {
    const { t } = await mk();
    const { owner, ws, post } = await world(t);
    const stranger = await t.newUser("s");
    for (const r of [await schedule(stranger, ws, post, { scheduledAt: inHours(1) }), await stranger.agent.get(`/workspaces/${ws}/calendar?month=2030-01`), await stranger.agent.delete(`/workspaces/${ws}/posts/${post}/schedule`)])
      expect(r.status).toBe(404);
    const viewer = await t.newUser("v");
    await t.db.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'viewer')", [ws, viewer.id]);
    expect((await schedule(viewer, ws, post, { scheduledAt: inHours(1) })).status).toBe(403);
    expect((await viewer.agent.get(`/workspaces/${ws}/calendar?month=2030-01`)).status).toBe(200);
    await schedule(owner, ws, post, { scheduledAt: inHours(1) });
    expect((await viewer.agent.delete(`/workspaces/${ws}/posts/${post}/schedule`)).status).toBe(403);
  });
});

describe("calendar", async () => {
  const li = createFakeAdapter("linkedin", () => ok("li-1"));
  const t = await createTestApp([li.adapter]);
  afterAll(t.close);

  it("returns month/week/range data grouped by LOCAL day with filters, drafts and truncation info", async () => {
    const { owner, ws, accounts } = await world(t);
    const yt = await seedAccount(t, ws, owner, "youtube");
    void yt;
    const mkJob = async (postId: string, status: string, at: string, platform = "linkedin") => {
      const v = (await t.db.query<{ id: string; social_account_id: string }>("SELECT id, social_account_id FROM post_variants WHERE post_id = $1", [postId])).rows[0]!;
      await t.db.query("INSERT INTO publishing_jobs (workspace_id, post_id, variant_id, social_account_id, platform, status, next_attempt_at, published_at, created_by, idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [ws, postId, v.id, v.social_account_id, platform, status, at, status === "published" ? at : null, owner.id, `k${Math.random()}`]);
    };
    const [a, b, c] = [await newPost(owner, ws, accounts.linkedin!, "A"), await newPost(owner, ws, accounts.linkedin!, "B"), await newPost(owner, ws, accounts.linkedin!, "C")];
    await mkJob(a, "scheduled", "2030-06-15T20:00:00Z");     // 01:30 on the 16th in Kolkata
    await mkJob(b, "published", "2030-06-16T05:00:00Z");
    await mkJob(c, "failed", "2030-07-02T05:00:00Z");        // next month
    const draft = await newPost(owner, ws, accounts.linkedin!, "just a draft");
    void draft;
    const cal = (qs: string) => owner.agent.get(`/workspaces/${ws}/calendar?${qs}`);

    const june = (await cal("month=2030-06&timezone=Asia/Kolkata")).body.data;
    expect(june.events.map((e: { preview: string }) => e.preview).sort()).toEqual(["A", "B"]);
    expect(Object.keys(june.days).sort()).toEqual(["2030-06-16"]);                         // both fall on the 16th in IST (the first is 15th in UTC)
    expect(june.events[0]).toMatchObject({ status: "scheduled", localAt: "2030-06-16T01:30:00", at: "2030-06-15T20:00:00.000Z" });
    const utc = (await cal("month=2030-06&timezone=UTC")).body.data;
    expect(Object.keys(utc.days).sort()).toEqual(["2030-06-15", "2030-06-16"]);            // same data, different grouping by zone
    expect((await cal("weekOf=2030-06-10&timezone=UTC")).body.data.events).toHaveLength(2);
    expect((await cal("weekOf=2030-06-17&timezone=UTC")).body.data.events).toHaveLength(0);
    expect((await cal("month=2030-06&status=published")).body.data.events.map((e: { preview: string }) => e.preview)).toEqual(["B"]);
    expect((await cal("month=2030-06&platform=x")).body.data.events).toHaveLength(0);
    expect((await cal("from=2030-06-01T00:00:00Z&to=2030-08-30T00:00:00Z")).status).toBe(400);   // > 62 days
    expect((await cal("month=2030-06&weekOf=2030-06-10")).status).toBe(400);
    expect((await cal("")).status).toBe(400);
    expect((await cal("month=2030-06")).body.data.unscheduledDrafts.map((d: { preview: string }) => d.preview)).toContain("just a draft");
    expect((await cal("month=2030-06")).body.data.truncated).toBe(false);
  });
});

describe("bulk operations", async () => {
  const li = createFakeAdapter("linkedin", () => ok("li-1"));
  const t = await createTestApp([li.adapter]);
  afterAll(t.close);

  it("bulk create: invalid items fail alone, valid ones are saved, indexes line up with the request", async () => {
    const { owner, ws, accounts } = await world(t);
    const res = await owner.agent.post(`/workspaces/${ws}/bulk/posts`).send({ posts: [
      { body: "one" },
      { hashtags: ["bad tag!"] },
      { body: "three", variants: [{ accountId: accounts.linkedin }] },
      { variants: [{ accountId: "00000000-0000-4000-8000-000000000000" }] },
    ] });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ total: 4, succeeded: 2, failed: 2 });
    expect(res.body.data.results.map((r: { index: number; ok: boolean }) => [r.index, r.ok])).toEqual([[0, true], [1, false], [2, true], [3, false]]);
    expect(res.body.data.results[1].error.code).toBe("VALIDATION_ERROR");
    expect(res.body.data.results[3].error.code).toBe("BAD_REQUEST");
    expect(res.body.data.results[2].data.variants).toHaveLength(1);
  });

  it("bulk schedule/cancel/status: each item independent, with individual failure details", async () => {
    const { owner, ws, accounts } = await world(t);
    const acct = accounts.linkedin!;
    const [p1, p2, p3] = [await newPost(owner, ws, acct, "1"), await newPost(owner, ws, acct, "2"), await newPost(owner, ws, acct, "3")];
    const at = Date.now() + 4 * 3600_000;
    const res = await owner.agent.post(`/workspaces/${ws}/bulk/schedule`).send({ items: [
      { postId: p1, scheduledAt: new Date(at).toISOString() },
      { postId: p2, scheduledAt: new Date(at + 60_000).toISOString() },                                       // conflicts with p1
      { postId: p3, scheduledAt: new Date(at + 30 * 60_000).toISOString() },
      { postId: "00000000-0000-4000-8000-000000000000", scheduledAt: new Date(at).toISOString() },           // unknown post
      { postId: p1, scheduledAt: "not a date" },
    ] });
    expect(res.status).toBe(400);                                                                              // schema failures reject the whole request up front
    const ok2 = await owner.agent.post(`/workspaces/${ws}/bulk/schedule`).send({ items: [
      { postId: p1, scheduledAt: new Date(at).toISOString() },
      { postId: p2, scheduledAt: new Date(at + 60_000).toISOString() },
      { postId: p3, scheduledAt: new Date(at + 30 * 60_000).toISOString() },
      { postId: "00000000-0000-4000-8000-000000000000", scheduledAt: new Date(at).toISOString() },
    ] });
    expect(ok2.body.data).toMatchObject({ total: 4, succeeded: 2, failed: 2 });
    expect(ok2.body.data.results.map((r: { ok: boolean; error?: { code: string } }) => r.ok ? "ok" : r.error!.code)).toEqual(["ok", "SCHEDULE_CONFLICT", "ok", "NOT_FOUND"]);

    const ids = (await t.db.query<{ id: string }>("SELECT id FROM publishing_jobs WHERE workspace_id = $1 ORDER BY created_at", [ws])).rows.map((r) => r.id);
    const status = await owner.agent.post(`/workspaces/${ws}/bulk/status`).send({ ids: [...ids, "00000000-0000-4000-8000-000000000000"] });
    expect(status.body.data.map((s: { status?: string; found: boolean }) => s.status ?? (s.found ? "?" : "missing"))).toEqual(["scheduled", "scheduled", "missing"]);

    const cancel = await owner.agent.post(`/workspaces/${ws}/bulk/cancel`).send({ ids: [ids[0], "00000000-0000-4000-8000-000000000000", ids[0]] });
    expect(cancel.body.data).toMatchObject({ total: 3, succeeded: 1, failed: 2 });
    expect(cancel.body.data.results[2].error.code).toBe("NOT_CANCELLABLE");                                    // second cancel of the same id
    const other = await world(t);
    const foreign = await other.owner.agent.post(`/workspaces/${other.ws}/bulk/status`).send({ ids });
    expect(foreign.body.data.every((s: { found: boolean }) => !s.found)).toBe(true);                           // another workspace sees none of them
  });
});
