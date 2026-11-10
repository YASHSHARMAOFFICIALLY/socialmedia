import { describe, it, expect, afterAll } from "vitest";
import { localOf, occurrenceAt, type Rule } from "../src/modules/recurring/rrule.js";
import { createFakeAdapter, ok } from "./helpers/fake-adapter.js";
import { createTestApp } from "./helpers/app.js";
import { drain, world, type T, type U } from "./helpers/world.js";

const R = (o: Partial<Rule> = {}): Rule => ({ frequency: "daily", interval: 1, startLocal: "2030-01-31T09:00", timezone: "UTC", count: 10, ...o });

describe("recurrence rules", () => {
  it("daily / weekly / monthly wall-clock progression, with month-end clamping", () => {
    expect([0, 1, 2].map((n) => localOf(R({ frequency: "daily", interval: 2 }), n))).toEqual(["2030-01-31T09:00", "2030-02-02T09:00", "2030-02-04T09:00"]);
    expect([0, 1].map((n) => localOf(R({ frequency: "weekly" }), n))).toEqual(["2030-01-31T09:00", "2030-02-07T09:00"]);
    expect([0, 1, 2, 3].map((n) => localOf(R({ frequency: "monthly" }), n))).toEqual(["2030-01-31T09:00", "2030-02-28T09:00", "2030-03-31T09:00", "2030-04-30T09:00"]);
    expect(localOf(R({ frequency: "monthly", interval: 12 }), 1)).toBe("2031-01-31T09:00");
  });
  it("stops at count or until date", () => {
    expect(occurrenceAt(R({ count: 2 }), 1)).not.toBeNull();
    expect(occurrenceAt(R({ count: 2 }), 2)).toBeNull();
    expect(occurrenceAt(R({ count: null, untilDate: "2030-02-02" }), 2)).not.toBeNull();   // 2030-02-02
    expect(occurrenceAt(R({ count: null, untilDate: "2030-02-02" }), 3)).toBeNull();
  });
  it("keeps the wall-clock time across daylight saving changes and handles the gap", () => {
    const ny = R({ timezone: "America/New_York", startLocal: "2030-03-08T09:00", count: 5 });
    expect(occurrenceAt(ny, 0)!.toISOString()).toBe("2030-03-08T14:00:00.000Z");      // EST (UTC-5)
    expect(occurrenceAt(ny, 3)!.toISOString()).toBe("2030-03-11T13:00:00.000Z");      // EDT (UTC-4): still 09:00 local
    const gap = R({ timezone: "America/New_York", startLocal: "2030-03-09T02:30", count: 3 });   // 2030-03-10 02:30 does not exist
    expect(occurrenceAt(gap, 1)!.toISOString()).toBe("2030-03-10T07:30:00.000Z");     // moved to 03:30 EDT
  });
});

describe("recurring series", async () => {
  const li = createFakeAdapter("linkedin", () => ok());
  const t: T = await createTestApp([li.adapter]);
  afterAll(t.close);
  const soon = (hours: number, tz = "UTC") => new Date(Date.now() + hours * 3600_000).toISOString().slice(0, 16);
  const create = (u: U, ws: string, post: string, body: object) => u.agent.post(`/workspaces/${ws}/posts/${post}/recurrence`).send(body);
  const series = async (u: U, ws: string, id: string) => (await u.agent.get(`/workspaces/${ws}/recurrences/${id}`)).body.data;
  const fastForward = (id: string, hours: number) => t.db.query("UPDATE recurring_series SET next_at = now() + make_interval(hours => $2) WHERE id = $1", [id, hours]);

  it("materializes occurrences inside the 24 h window as scheduled copies of the CURRENT template; idempotent; ends after count", async () => {
    const w = await world(t, ["linkedin"], "Weekly tip");
    const s = await create(w.owner, w.ws, w.post, { frequency: "daily", startLocal: soon(2), timezone: "UTC", count: 3 });
    expect(s.status).toBe(201);
    const id = s.body.data.id;
    expect(s.body.data).toMatchObject({ status: "active", occurrencesCreated: 0 });
    expect(await t.deps.engine.recurring.sweep()).toMatchObject({ materialized: 1, scheduled: 1, failed: 0 });   // occurrence 0 (in 2h); occurrence 1 is 26h away
    expect(await t.deps.engine.recurring.sweep()).toMatchObject({ materialized: 0, scheduled: 0 });                 // repeat = no-op
    let d = await series(w.owner, w.ws, id);
    expect(d.occurrences).toHaveLength(1);
    expect(d.occurrences[0]).toMatchObject({ number: 0, status: "scheduled" });
    const copy = d.occurrences[0].postId;
    expect(copy).not.toBe(w.post);
    expect((await w.owner.agent.get(`/workspaces/${w.ws}/posts/${copy}`)).body.data).toMatchObject({ body: "Weekly tip", status: "submitted", title: "T" });   // same title, no "(copy)"
    expect((await w.owner.agent.get(`/workspaces/${w.ws}/posts/${w.post}`)).body.data.status).toBe("draft");          // the template itself is never published
    // editing the template changes FUTURE copies only
    await w.owner.agent.patch(`/workspaces/${w.ws}/posts/${w.post}`).send({ body: "Updated tip" });
    await fastForward(id, 1);
    await t.deps.engine.recurring.sweep();
    d = await series(w.owner, w.ws, id);
    expect(d.occurrences.map((o: { status: string }) => o.status)).toEqual(["scheduled", "scheduled"]);
    expect((await w.owner.agent.get(`/workspaces/${w.ws}/posts/${copy}`)).body.data.body).toBe("Weekly tip");
    expect((await w.owner.agent.get(`/workspaces/${w.ws}/posts/${d.occurrences[1].postId}`)).body.data.body).toBe("Updated tip");
    await fastForward(id, 1);
    await t.deps.engine.recurring.sweep();
    d = await series(w.owner, w.ws, id);
    expect(d.occurrences).toHaveLength(3);
    expect(d).toMatchObject({ status: "ended", nextAt: null, occurrencesCreated: 3 });                                 // count reached
    // the copies publish like any scheduled post
    await t.db.query("UPDATE publishing_jobs SET next_attempt_at = now() - interval '1s' WHERE status = 'scheduled'; UPDATE outbox_events SET available_at = now() - interval '1s' WHERE dispatched_at IS NULL");
    await t.deps.engine.sweep();
    expect((await drain(t)).filter((x) => x === "published")).toHaveLength(3);
  });

  it("pause skips occurrences, resume continues; ending can cancel what is still scheduled", async () => {
    const w = await world(t, ["linkedin"], "Pausable");
    const id = (await create(w.owner, w.ws, w.post, { frequency: "weekly", startLocal: soon(3), timezone: "UTC", untilDate: "2099-01-01" })).body.data.id;
    expect((await w.owner.agent.patch(`/workspaces/${w.ws}/recurrences/${id}`).send({ status: "paused" })).body.data.status).toBe("paused");
    await t.deps.engine.recurring.sweep();
    expect((await series(w.owner, w.ws, id)).occurrences).toHaveLength(0);                                              // paused series are not materialized
    await w.owner.agent.patch(`/workspaces/${w.ws}/recurrences/${id}`).send({ status: "active" });
    await t.deps.engine.recurring.sweep();
    const copy = (await series(w.owner, w.ws, id)).occurrences[0].postId;
    expect((await w.owner.agent.get(`/workspaces/${w.ws}/posts/${copy}/schedule`)).body.data.state).toBe("scheduled");
    const ended = await w.owner.agent.delete(`/workspaces/${w.ws}/recurrences/${id}?cancelScheduled=true`);
    expect(ended.body.data).toEqual({ id, status: "ended", cancelledOccurrences: 1 });
    expect((await w.owner.agent.get(`/workspaces/${w.ws}/posts/${copy}/schedule`)).body.data.state).toBe("cancelled");
    expect((await w.owner.agent.patch(`/workspaces/${w.ws}/recurrences/${id}`).send({ status: "active" })).body.error.code).toBe("SERIES_ENDED");
  });

  it("approval-required workspaces: unapproved copies fail loudly (notification), nothing is published", async () => {
    const w = await world(t, ["linkedin"], "Needs review");
    await w.owner.agent.put(`/workspaces/${w.ws}/approval-policy`).send({ required: true });
    const id = (await create(w.owner, w.ws, w.post, { frequency: "daily", startLocal: soon(2), timezone: "UTC", count: 2 })).body.data.id;
    expect(await t.deps.engine.recurring.sweep()).toMatchObject({ failed: 1, scheduled: 0 });
    expect((await series(w.owner, w.ws, id)).occurrences[0]).toMatchObject({ status: "failed", error: expect.stringContaining("APPROVAL_REQUIRED") });
    expect((await t.db.query("SELECT 1 FROM notifications WHERE type = 'series_occurrence_failed' AND user_id = $1", [w.owner.id])).rowCount).toBe(1);
  });

  it("late occurrences: slightly late still go out, hours late are skipped", async () => {
    const w = await world(t, ["linkedin"], "Late");
    const id = (await create(w.owner, w.ws, w.post, { frequency: "daily", startLocal: soon(2), timezone: "UTC", count: 5 })).body.data.id;
    await t.deps.engine.recurring.sweep();
    await t.db.query("UPDATE series_occurrences SET status = 'pending', post_id = NULL, scheduled_at = now() - interval '10 hours' WHERE series_id = $1", [id]);
    expect(await t.deps.engine.recurring.sweep()).toMatchObject({ skipped: 1 });
    expect((await series(w.owner, w.ws, id)).occurrences[0]).toMatchObject({ status: "skipped", error: expect.stringContaining("6 hours") });
  });

  it("a crashed worker is recovered: a 'processing' occurrence that stalled is retried without making a second copy", async () => {
    const w = await world(t, ["linkedin"], "Crashy");
    const id = (await create(w.owner, w.ws, w.post, { frequency: "daily", startLocal: soon(2), timezone: "UTC", count: 3 })).body.data.id;
    await t.deps.engine.recurring.sweep();
    const before = (await series(w.owner, w.ws, id)).occurrences[0].postId;
    await t.db.query("UPDATE series_occurrences SET status = 'processing', claimed_at = now() - interval '10 minutes' WHERE series_id = $1", [id]);
    await t.db.query("DELETE FROM publishing_jobs WHERE post_id = $1", [before]);
    await t.db.query("UPDATE posts SET status = 'draft' WHERE id = $1", [before]);   // schedule never happened
    await t.deps.engine.recurring.sweep();
    const after = (await series(w.owner, w.ws, id)).occurrences[0];
    expect(after).toMatchObject({ status: "scheduled", postId: before });                                                   // same copy re-used
    expect((await t.db.query("SELECT 1 FROM posts WHERE workspace_id = $1 AND title = 'T'", [w.ws])).rowCount).toBe(2);   // template + one copy
  });

  it("validation, authorization and isolation", async () => {
    const w = await world(t, ["linkedin"], "Rules");
    const bad = async (b: object) => (await create(w.owner, w.ws, w.post, b)).status;
    expect(await bad({ frequency: "daily", startLocal: soon(2), timezone: "UTC" })).toBe(400);                              // endless series refused
    expect(await bad({ frequency: "daily", startLocal: "2020-01-01T09:00", timezone: "UTC", count: 2 })).toBe(400);         // first occurrence in the past
    expect(await bad({ frequency: "daily", startLocal: soon(2), timezone: "Mars/Base", count: 2 })).toBe(400);
    expect(await bad({ frequency: "yearly", startLocal: soon(2), timezone: "UTC", count: 2 })).toBe(400);
    const empty = (await w.owner.agent.post(`/workspaces/${w.ws}/posts`).send({ body: "x" })).body.data.id;
    expect((await create(w.owner, w.ws, empty, { frequency: "daily", startLocal: soon(2), timezone: "UTC", count: 2 })).status).toBe(400);   // no destinations
    const id = (await create(w.owner, w.ws, w.post, { frequency: "daily", startLocal: soon(2), timezone: "UTC", count: 2 })).body.data.id;
    const stranger = await t.newUser("s"), viewer = await t.newUser("v");
    await t.db.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'viewer')", [w.ws, viewer.id]);
    for (const r of [await stranger.agent.get(`/workspaces/${w.ws}/recurrences/${id}`), await stranger.agent.get(`/workspaces/${w.ws}/recurrences`), await create(stranger, w.ws, w.post, { frequency: "daily", startLocal: soon(2), timezone: "UTC", count: 2 })]) expect(r.status).toBe(404);
    expect((await viewer.agent.get(`/workspaces/${w.ws}/recurrences/${id}`)).status).toBe(200);
    expect((await viewer.agent.patch(`/workspaces/${w.ws}/recurrences/${id}`).send({ status: "paused" })).status).toBe(403);
    expect((await viewer.agent.delete(`/workspaces/${w.ws}/recurrences/${id}`)).status).toBe(403);
    const other = await world(t, ["linkedin"]);
    expect((await other.owner.agent.get(`/workspaces/${other.ws}/recurrences/${id}`)).status).toBe(404);
  });
});
