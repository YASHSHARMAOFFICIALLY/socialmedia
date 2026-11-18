import { describe, it, expect, afterAll } from "vitest";
import { PlatformError } from "../src/integrations/core/errors.js";
import { createFakeAdapter, ok } from "./helpers/fake-adapter.js";
import { createTestApp } from "./helpers/app.js";

import { world, seedAccount, publish, jobs, drain, makeDue, type T, type U } from "./helpers/world.js";

describe("publishing engine", async () => {
  const closers: (() => Promise<void>)[] = [];
  afterAll(async () => { for (const c of closers) await c(); });
  const mk = async (adapters: ReturnType<typeof createFakeAdapter>[], engine?: Parameters<typeof createTestApp>[1]) => {
    const t = await createTestApp(adapters.map((a) => a.adapter), engine);
    closers.push(t.close);
    return t;
  };

  it("publishes end-to-end: pending → queued → processing → published, with history and no internals leaked", async () => {
    const li = createFakeAdapter("linkedin", () => ok("li-1"));
    const t = await mk([li]);
    const { owner, ws, post } = await world(t);
    const res = await publish(owner, ws, post);
    expect(res.status).toBe(202);
    expect(res.body.data.jobs).toHaveLength(1);
    expect(res.body.data.jobs[0].status).toBe("pending");
    expect(JSON.stringify(res.body)).not.toMatch(/lease|idempotency_key|plain-access-token/);
    expect(t.queued).toHaveLength(1);                       // immediate dispatch through the outbox
    expect(await drain(t)).toEqual(["published"]);
    expect(li.calls[0]!.accessToken).toBe("plain-access-token");   // decrypted only inside the engine
    expect(li.calls[0]!.content.text).toBe("Hello world");
    const id = res.body.data.jobs[0].id;
    const job = (await owner.agent.get(`/workspaces/${ws}/publications/${id}`)).body.data;
    expect(job).toMatchObject({ status: "published", external_id: "li-1", attempt_count: 1 });
    expect(job.attempts.map((a: { outcome: string }) => a.outcome)).toEqual(["success"]);
    expect(job.events.map((e: { to_status: string }) => e.to_status)).toEqual(["pending", "processing", "published"]);
    expect((await owner.agent.get(`/workspaces/${ws}/posts/${post}`)).body.data.status).toBe("submitted");
    expect(JSON.stringify(job)).not.toMatch(/lease/);
  });

  it("platforms are independent: a permanent failure on X does not affect LinkedIn or YouTube", async () => {
    const li = createFakeAdapter("linkedin", () => ok("li")), x = createFakeAdapter("x", () => { throw new PlatformError("permanent", "duplicate content"); }), yt = createFakeAdapter("youtube", () => ok("yt"));
    const t = await mk([li, x, yt]);
    const { owner, ws, post, accounts } = await world(t, ["linkedin", "x", "youtube"]);
    // youtube needs a video + title; give it its own variant media so it validates
    const vid = (await t.db.query<{ id: string }>("INSERT INTO media_assets (workspace_id, kind, storage_key, filename, mime_type, size_bytes, status, created_by) VALUES ($1,'video','k','v.mp4','video/mp4',10,'ready',$2) RETURNING id", [ws, owner.id])).rows[0]!.id;
    await owner.agent.put(`/workspaces/${ws}/posts/${post}/variants/${accounts.youtube}`).send({ title: "Vid", media: [{ mediaId: vid }] });
    expect((await publish(owner, ws, post)).status).toBe(202);
    await drain(t);
    const byPlatform = Object.fromEntries((await jobs(t, ws)).map((j) => [j.platform, j.status]));
    expect(byPlatform).toEqual({ linkedin: "published", x: "failed", youtube: "published" });
    expect((await jobs(t, ws)).find((j) => j.platform === "x")).toMatchObject({ failure_kind: "permanent", attempt_count: 1 });
    expect(x.calls).toHaveLength(1);   // permanent failures are never retried
  });

  it("DUPLICATE PREVENTION: concurrent/redelivered processing of one job calls the platform exactly once", async () => {
    const li = createFakeAdapter("linkedin", async () => { await new Promise((r) => setTimeout(r, 20)); return ok(); });
    const t = await mk([li]);
    const { owner, ws, post } = await world(t);
    const id = (await publish(owner, ws, post)).body.data.jobs[0].id;
    const results = await Promise.all(Array.from({ length: 6 }, () => t.deps.engine.process(id)));
    expect(results.filter((r) => r === "published")).toHaveLength(1);
    expect(results.filter((r) => r === "skipped")).toHaveLength(5);
    expect(li.calls).toHaveLength(1);
    expect(await t.deps.engine.process(id)).toBe("skipped");        // late redelivery after success
    expect(li.calls).toHaveLength(1);
  });

  it("DUPLICATE PREVENTION: publishing twice is rejected and the DB forbids a second live job per variant", async () => {
    const li = createFakeAdapter("linkedin", () => ok());
    const t = await mk([li]);
    const { owner, ws, post } = await world(t);
    expect((await publish(owner, ws, post)).status).toBe(202);
    const again = await publish(owner, ws, post);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("ALREADY_SUBMITTED");
    const v = (await t.db.query<{ id: string; social_account_id: string }>("SELECT id, social_account_id FROM post_variants WHERE post_id = $1", [post])).rows[0]!;
    await expect(t.db.query("INSERT INTO publishing_jobs (workspace_id, post_id, variant_id, social_account_id, platform, created_by, idempotency_key) VALUES ($1,$2,$3,$4,'linkedin',$5,'dup')", [ws, post, v.id, v.social_account_id, owner.id])).rejects.toThrow(/unique|duplicate/i);
    await drain(t);
    expect(li.calls).toHaveLength(1);
  });

  it("Idempotency-Key: a replayed request returns the original jobs and creates nothing new; key reuse on another post is rejected", async () => {
    const li = createFakeAdapter("linkedin", () => ok());
    const t = await mk([li]);
    const { owner, ws, post, accounts } = await world(t);
    const first = await publish(owner, ws, post, {}, "key-12345678");
    const replay = await publish(owner, ws, post, {}, "key-12345678");
    expect(first.status).toBe(202);
    expect(replay.status).toBe(200);
    expect(replay.body.data.jobs.map((j: { id: string }) => j.id)).toEqual(first.body.data.jobs.map((j: { id: string }) => j.id));
    expect((await jobs(t, ws))).toHaveLength(1);
    const other = (await owner.agent.post(`/workspaces/${ws}/posts`).send({ body: "x", variants: [{ accountId: accounts.linkedin }] })).body.data.id;
    expect((await publish(owner, ws, other, {}, "key-12345678")).body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect((await publish(owner, ws, post, {}, "no")).status).toBe(400);
  });

  it("retries transient failures with exponential backoff, honouring the schedule, then succeeds", async () => {
    const li = createFakeAdapter("linkedin", (n) => { if (n < 3) throw new PlatformError("retryable", "503 upstream"); return ok(); }, {});
    const t = await mk([li], { engine: { random: () => 1 } });
    const { owner, ws, post } = await world(t);
    const id = (await publish(owner, ws, post)).body.data.jobs[0].id;
    expect(await drain(t)).toEqual(["retry_scheduled"]);
    let job = (await jobs(t, ws))[0]!;
    expect(job).toMatchObject({ status: "pending", attempt_count: 1 });
    const due = (await t.db.query<{ s: number }>("SELECT EXTRACT(EPOCH FROM next_attempt_at - now())::float8 AS s FROM publishing_jobs WHERE id = $1", [id])).rows[0]!.s;
    expect(due).toBeGreaterThan(20); expect(due).toBeLessThanOrEqual(30);
    expect(await t.deps.engine.process(id)).toBe("skipped");        // not due yet: an early redelivery is a no-op
    expect(li.calls).toHaveLength(1);
    await t.db.query("UPDATE publishing_jobs SET next_attempt_at = now() - interval '1s' WHERE id = $1", [id]);
    expect(await t.deps.engine.process(id)).toBe("retry_scheduled");
    await makeDue(t, id);
    expect(await t.deps.engine.process(id)).toBe("published");
    job = (await jobs(t, ws))[0]!;
    expect(job).toMatchObject({ status: "published", attempt_count: 3 });
    const detail = (await owner.agent.get(`/workspaces/${ws}/publications/${id}`)).body.data;
    expect(detail.attempts.map((a: { outcome: string }) => a.outcome)).toEqual(["retryable", "retryable", "success"]);
  });

  it("the retry is scheduled through the outbox so it survives queue loss", async () => {
    const li = createFakeAdapter("linkedin", (n) => { if (n < 2) throw new PlatformError("retryable", "503"); return ok(); });
    const t = await mk([li]);
    const { owner, ws, post } = await world(t);
    const id = (await publish(owner, ws, post)).body.data.jobs[0].id;
    await drain(t);
    const pending = (await t.db.query("SELECT 1 FROM outbox_events WHERE aggregate_id = $1 AND dispatched_at IS NULL AND available_at > now()", [id])).rowCount;
    expect(pending).toBe(1);
  });

  it("gives up after max attempts (dead-lettered), and a manual retry starts a fresh cycle", async () => {
    let fail = true;
    const li = createFakeAdapter("linkedin", () => { if (fail) throw new PlatformError("retryable", "503"); return ok(); });
    const t = await mk([li]);
    const { owner, ws, post } = await world(t);
    const id = (await publish(owner, ws, post)).body.data.jobs[0].id;
    await t.db.query("UPDATE publishing_jobs SET max_attempts = 2 WHERE id = $1", [id]);
    await drain(t); await makeDue(t, id);
    expect(await t.deps.engine.process(id)).toBe("failed");
    const j = (await t.db.query<{ status: string; failure_kind: string; dead_lettered_at: string | null }>("SELECT status, failure_kind, dead_lettered_at FROM publishing_jobs WHERE id = $1", [id])).rows[0]!;
    expect(j).toMatchObject({ status: "failed", failure_kind: "exhausted" });
    expect(j.dead_lettered_at).not.toBeNull();
    expect((await publish(owner, ws, post)).status).toBe(409);                    // failed jobs go through retry, not a fresh publish
    fail = false;
    expect((await owner.agent.post(`/workspaces/${ws}/publications/${id}/retry`)).status).toBe(202);
    await drain(t);
    expect((await jobs(t, ws))[0]).toMatchObject({ status: "published", attempt_count: 3 });   // attempt numbers keep counting: history is never overwritten
    expect((await owner.agent.post(`/workspaces/${ws}/publications/${id}/retry`)).status).toBe(409);  // only failed jobs
  });

  it("rate limits wait at least Retry-After", async () => {
    const li = createFakeAdapter("linkedin", () => { throw new PlatformError("rate_limited", "429", { retryAfterS: 1800 }); });
    const t = await mk([li]);
    const { owner, ws, post } = await world(t);
    const id = (await publish(owner, ws, post)).body.data.jobs[0].id;
    await drain(t);
    const s = (await t.db.query<{ s: number }>("SELECT EXTRACT(EPOCH FROM next_attempt_at - now())::float8 AS s FROM publishing_jobs WHERE id = $1", [id])).rows[0]!.s;
    expect(s).toBeGreaterThan(1700);
  });

  it("expired tokens: no platform call, account flagged needs_reauth, job fails as auth_expired (not retried)", async () => {
    const li = createFakeAdapter("linkedin", () => ok());
    const t = await mk([li]);
    const { owner, ws, post, accounts } = await world(t);
    await t.db.query("UPDATE oauth_credentials SET expires_at = now() - interval '1 hour' WHERE social_account_id = $1", [accounts.linkedin]);
    await publish(owner, ws, post);
    expect(await drain(t)).toEqual(["failed"]);
    expect(li.calls).toHaveLength(0);
    expect((await jobs(t, ws))[0]).toMatchObject({ status: "failed", failure_kind: "auth_expired" });
    expect((await owner.agent.get(`/workspaces/${ws}/accounts/${accounts.linkedin}`)).body.data.status).toBe("needs_reauth");
    expect((await publish(owner, ws, (await owner.agent.post(`/workspaces/${ws}/posts`).send({ body: "n", variants: [{ accountId: accounts.linkedin }] })).body.data.id)).body.error.code).toBe("POST_NOT_PUBLISHABLE");
  });

  describe("unknown outcomes (timeouts/crashes) are reconciled, never blindly retried", () => {
    it("a timed-out publish becomes 'reconciling'; the sweeper confirms it exists on the platform without re-publishing", async () => {
      const li = createFakeAdapter("linkedin", () => new Promise(() => {}), { reconcile: async () => ({ externalId: "found-on-platform", url: "https://fake/found" }) });
      const t = await mk([li], { engine: { timeoutMs: 30 } });
      const { owner, ws, post } = await world(t);
      const id = (await publish(owner, ws, post)).body.data.jobs[0].id;
      expect(await drain(t)).toEqual(["reconciling"]);
      expect((await jobs(t, ws))[0]).toMatchObject({ status: "processing", needs_reconciliation: true });
      expect((await publish(owner, ws, post)).status).toBe(409);
      const rep = await t.deps.engine.sweep();
      expect(rep.reconciled).toBe(1);
      expect((await jobs(t, ws))[0]).toMatchObject({ status: "published", external_id: "found-on-platform", needs_reconciliation: false });
      expect(li.calls).toHaveLength(1);                      // never published a second time
      const ev = (await owner.agent.get(`/workspaces/${ws}/publications/${id}`)).body.data.events.map((e: { reason: string }) => e.reason);
      expect(ev.some((r: string) => /reconciled/.test(r))).toBe(true);
    });

    it("a DB error AFTER the platform accepted the post is reconciled, never marked failed (a manual retry would duplicate it)", async () => {
      const li = createFakeAdapter("linkedin", () => ok("live-1"), { reconcile: async () => ({ externalId: "live-1" }) });
      const t = await mk([li]);
      const { owner, ws, post } = await world(t);
      await publish(owner, ws, post);
      await t.db.query("CREATE FUNCTION boom() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'connection terminated'; END $$ LANGUAGE plpgsql");
      await t.db.query("CREATE TRIGGER boom BEFORE INSERT ON billing_usage_events FOR EACH ROW EXECUTE FUNCTION boom()");
      expect(await drain(t)).toEqual(["reconciling"]);
      expect((await jobs(t, ws))[0]).toMatchObject({ status: "processing", needs_reconciliation: true });
      await t.db.query("DROP TRIGGER boom ON billing_usage_events");
      expect((await t.deps.engine.sweep()).reconciled).toBe(1);
      expect((await jobs(t, ws))[0]).toMatchObject({ status: "published", external_id: "live-1" });
      expect(li.calls).toHaveLength(1);
    });

    it("a lost recording keeps the external id, so even a platform that cannot be queried ends 'published'", async () => {
      const li = createFakeAdapter("linkedin", () => ok("live-2"));   // no reconcile (LinkedIn, Pinterest, TikTok, Telegram)
      const t = await mk([li]);
      const { owner, ws, post } = await world(t);
      await publish(owner, ws, post);
      await t.db.query("CREATE FUNCTION boom2() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'connection terminated'; END $$ LANGUAGE plpgsql");
      await t.db.query("CREATE TRIGGER boom2 BEFORE INSERT ON billing_usage_events FOR EACH ROW EXECUTE FUNCTION boom2()");
      expect(await drain(t)).toEqual(["reconciling"]);
      await t.db.query("DROP TRIGGER boom2 ON billing_usage_events");
      await t.deps.engine.sweep();
      expect((await jobs(t, ws))[0]).toMatchObject({ status: "published", external_id: "live-2" });
      expect(li.calls).toHaveLength(1);
    });

    it("a non-platform error from publish (e.g. a JSON parse of an empty 200) is 'unknown', never a retryable failure", async () => {
      const li = createFakeAdapter("linkedin", () => { throw new SyntaxError("Unexpected end of JSON input"); }, { reconcile: async () => ({ externalId: "it-was-live" }) });
      const t = await mk([li]);
      const { owner, ws, post } = await world(t);
      await publish(owner, ws, post);
      expect(await drain(t)).toEqual(["reconciling"]);
      await t.deps.engine.sweep();
      expect((await jobs(t, ws))[0]).toMatchObject({ status: "published", external_id: "it-was-live" });
    });

    it("reconcile never confirms with an older identical post or an id another job already owns", async () => {
      const seen: { since: Date; exclude?: string[] | undefined }[] = [];
      const li = createFakeAdapter("linkedin", () => { throw new PlatformError("unknown", "timeout"); }, {
        reconcile: async (i) => { seen.push({ since: i.since, exclude: i.exclude }); return null; },
      });
      const t = await mk([li]);
      const { owner, ws, post } = await world(t);
      const id = (await publish(owner, ws, post)).body.data.jobs[0].id;
      // Recurring posts are created a day ahead; another job on this account already owns "yesterday".
      await t.db.query("UPDATE publishing_jobs SET created_at = now() - interval '1 day' WHERE id = $1", [id]);
      const other = await t.db.query<{ id: string }>(
        `INSERT INTO publishing_jobs (workspace_id, post_id, variant_id, social_account_id, platform, status, next_attempt_at, created_by, idempotency_key, external_id)
         SELECT workspace_id, post_id, variant_id, social_account_id, platform, 'failed', now(), created_by, 'other-key', 'yesterday' FROM publishing_jobs WHERE id = $1 RETURNING id`, [id]);
      expect(other.rows).toHaveLength(1);
      const before = Date.now();
      await drain(t);
      await t.deps.engine.sweep();
      expect(seen).toHaveLength(1);
      expect(seen[0]!.since.getTime()).toBeGreaterThan(before - 5 * 60_000);   // the current attempt, not created_at - 60s
      expect(seen[0]!.exclude).toEqual(["yesterday"]);
    });

    it("keeps looking until the window passes, then fails as 'unconfirmed' (no auto-retry); manual retry warns about a possible duplicate", async () => {
      const li = createFakeAdapter("linkedin", () => { throw new PlatformError("unknown", "socket hang up"); }, { reconcile: async () => null });
      const t = await mk([li]);
      const { owner, ws, post } = await world(t);
      const id = (await publish(owner, ws, post)).body.data.jobs[0].id;
      await drain(t);
      await t.deps.engine.sweep();
      expect((await jobs(t, ws))[0]).toMatchObject({ status: "processing", needs_reconciliation: true });   // too early to give up
      await t.db.query("UPDATE publishing_jobs SET unknown_since = now() - interval '11 minutes' WHERE id = $1", [id]);
      await t.deps.engine.sweep();
      expect((await jobs(t, ws))[0]).toMatchObject({ status: "failed", failure_kind: "unconfirmed" });
      expect(li.calls).toHaveLength(1);
      const retry = await owner.agent.post(`/workspaces/${ws}/publications/${id}/retry`);
      expect(retry.status).toBe(202);
      expect(retry.body.data.warning).toMatch(/may already exist/);
    });

    it("platforms that cannot be queried fail immediately as 'unconfirmed' instead of risking a duplicate", async () => {
      const li = createFakeAdapter("linkedin", () => { throw new PlatformError("unknown", "timeout"); });
      const t = await mk([li]);
      const { owner, ws, post } = await world(t);
      await publish(owner, ws, post);
      await drain(t);
      await t.deps.engine.sweep();
      expect((await jobs(t, ws))[0]).toMatchObject({ status: "failed", failure_kind: "unconfirmed" });
      expect(li.calls).toHaveLength(1);
    });

    it("worker crash mid-publish: the expired lease is detected and reconciled; the post is not published twice", async () => {
      const li = createFakeAdapter("linkedin", () => ok("never-called"), { reconcile: async () => ({ externalId: "published-before-crash" }) });
      const t = await mk([li]);
      const { owner, ws, post } = await world(t);
      const id = (await publish(owner, ws, post)).body.data.jobs[0].id;
      t.queued.length = 0;
      // Simulate a worker that claimed the job (and maybe called the platform) then died.
      await t.db.query("UPDATE publishing_jobs SET status='processing', lease_token=gen_random_uuid(), lease_until = now() - interval '1 minute', attempt_count = 1 WHERE id = $1", [id]);
      const rep = await t.deps.engine.sweep();
      expect(rep.leasesExpired).toBe(1);
      expect((await jobs(t, ws))[0]).toMatchObject({ status: "published", external_id: "published-before-crash" });
      expect(li.calls).toHaveLength(0);
    });

    it("lease fencing: a worker that lost its lease cannot overwrite the new owner's result", async () => {
      let t!: T;
      const li = createFakeAdapter("linkedin", async () => {
        await t.db.query("UPDATE publishing_jobs SET lease_token = gen_random_uuid()");   // someone else took over
        return ok("late");
      });
      t = await mk([li]);
      const { owner, ws, post } = await world(t);
      const id = (await publish(owner, ws, post)).body.data.jobs[0].id;
      expect(await t.deps.engine.process(id)).toBe("lease_lost");
      expect((await jobs(t, ws))[0]!.status).toBe("processing");
    });
  });

  it("recovery: queue outage does not fail the API call; the outbox delivers once the queue is back", async () => {
    let down = true;
    const li = createFakeAdapter("linkedin", () => ok());
    const t = await mk([li], { queueFails: () => down });
    const { owner, ws, post } = await world(t);
    expect((await publish(owner, ws, post)).status).toBe(202);
    expect(t.queued).toHaveLength(0);
    expect((await t.deps.engine.sweep()).errors.length).toBe(1);        // still down; nothing lost
    down = false;
    expect((await t.deps.engine.sweep()).dispatched).toBe(1);
    expect(await drain(t)).toEqual(["published"]);
  });

  it("recovery: a lost queue message (already 'dispatched') is healed by the sweeper", async () => {
    const li = createFakeAdapter("linkedin", () => ok());
    const t = await mk([li]);
    const { owner, ws, post } = await world(t);
    const id = (await publish(owner, ws, post)).body.data.jobs[0].id;
    t.queued.length = 0;                                                // the message vanished (retention expiry / Redis-style loss)
    await t.db.query("UPDATE publishing_jobs SET next_attempt_at = now() - interval '10 minutes', last_enqueued_at = now() - interval '10 minutes' WHERE id = $1", [id]);
    const rep = await t.deps.engine.sweep();
    expect(rep.healed).toBe(1);
    expect(t.queued).toEqual([id]);
    expect(await drain(t)).toEqual(["published"]);
  });

  it("a failing sweep step never blocks the others (queue down must not stop crash recovery)", async () => {
    const li = createFakeAdapter("linkedin", () => ok(), { reconcile: async () => ({ externalId: "found" }) });
    const t = await mk([li], { queueFails: () => true });
    const { owner, ws, post } = await world(t);
    const id = (await publish(owner, ws, post)).body.data.jobs[0].id;
    await t.db.query("UPDATE publishing_jobs SET status='processing', lease_token=gen_random_uuid(), lease_until = now() - interval '1 minute', attempt_count = 1 WHERE id = $1", [id]);
    const rep = await t.deps.engine.sweep();
    expect(rep.errors.some((e) => e.startsWith("dispatch-outbox"))).toBe(true);
    expect(rep.leasesExpired).toBe(1);
    expect(rep.reconciled).toBe(1);
    expect((await jobs(t, ws))[0]!.status).toBe("published");
  });

  it("cancel: pending can be cancelled and never runs; processing/published cannot", async () => {
    const li = createFakeAdapter("linkedin", () => ok());
    const t = await mk([li]);
    const { owner, ws, post } = await world(t);
    const id = (await publish(owner, ws, post)).body.data.jobs[0].id;
    expect((await owner.agent.post(`/workspaces/${ws}/publications/${id}/cancel`)).status).toBe(204);
    expect(await drain(t)).toEqual(["skipped"]);
    expect(li.calls).toHaveLength(0);
    expect((await owner.agent.post(`/workspaces/${ws}/publications/${id}/cancel`)).status).toBe(409);
    // a cancelled destination can be published again
    expect((await publish(owner, ws, post)).status).toBe(202);
    await drain(t);
    const all = await jobs(t, ws);
    expect(all.map((j) => j.status).sort()).toEqual(["cancelled", "published"]);
    const published = all.find((j) => j.status === "published")!;
    expect((await owner.agent.post(`/workspaces/${ws}/publications/${published.id}/cancel`)).body.error.code).toBe("NOT_CANCELLABLE");
  });

  it("refuses to publish invalid content or destinations whose platform integration is unavailable", async () => {
    const li = createFakeAdapter("linkedin", () => ok());
    const t = await mk([li]);
    const w = await world(t, ["linkedin", "x"]);                         // no X adapter configured
    const blocked = await publish(w.owner, w.ws, w.post);
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe("POST_NOT_PUBLISHABLE");
    expect(blocked.body.error.details.variants[0].publishBlockers.join()).toMatch(/not configured/);
    expect(await jobs(t, w.ws)).toHaveLength(0);                          // all-or-nothing: nothing was created
    const only = await publish(w.owner, w.ws, w.post, { accountIds: [w.accounts.linkedin!] });
    expect(only.status).toBe(202);
    const t2 = await mk([createFakeAdapter("x", () => ok()), li]);
    const w2 = await world(t2, ["x"], "a".repeat(400));
    const tooLong = await publish(w2.owner, w2.ws, w2.post);
    expect(tooLong.status).toBe(422);
    expect(JSON.stringify(tooLong.body.error.details)).toMatch(/TEXT_TOO_LONG/);
  });

  it("media-bearing posts fail permanently (not retried) while object storage is not configured", async () => {
    const li = createFakeAdapter("linkedin", () => ok());
    const t = await mk([li]);
    const { owner, ws, post } = await world(t);
    const m = (await t.db.query<{ id: string }>("INSERT INTO media_assets (workspace_id, kind, storage_key, filename, mime_type, size_bytes, status, created_by) VALUES ($1,'image','k','a.jpg','image/jpeg',10,'ready',$2) RETURNING id", [ws, owner.id])).rows[0]!.id;
    await owner.agent.patch(`/workspaces/${ws}/posts/${post}`).send({ media: [{ mediaId: m }] });
    await publish(owner, ws, post);
    await drain(t);
    expect(li.calls).toHaveLength(1);       // the adapter is called; resolving the media URL is what fails
  });

  it("authorization + tenant isolation on every publishing route", async () => {
    const li = createFakeAdapter("linkedin", () => ok());
    const t = await mk([li]);
    const { owner, ws, post } = await world(t);
    const id = (await publish(owner, ws, post)).body.data.jobs[0].id;
    const stranger = await t.newUser("stranger");
    for (const r of [
      await publish(stranger, ws, post), await stranger.agent.get(`/workspaces/${ws}/publications`), await stranger.agent.get(`/workspaces/${ws}/publications/${id}`),
      await stranger.agent.post(`/workspaces/${ws}/publications/${id}/cancel`), await stranger.agent.post(`/workspaces/${ws}/publications/${id}/retry`),
    ]) expect(r.status).toBe(404);
    const viewer = await t.newUser("viewer");
    await t.db.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'viewer')", [ws, viewer.id]);
    expect((await viewer.agent.get(`/workspaces/${ws}/publications/${id}`)).status).toBe(200);
    expect((await publish(viewer, ws, post)).status).toBe(403);
    expect((await viewer.agent.post(`/workspaces/${ws}/publications/${id}/cancel`)).status).toBe(403);
    const other = await world(t);
    expect((await other.owner.agent.get(`/workspaces/${other.ws}/publications/${id}`)).status).toBe(404);   // id from another workspace
  });

  it("lists publications with filters and pagination", async () => {
    const li = createFakeAdapter("linkedin", () => ok());
    const t = await mk([li]);
    const { owner, ws, accounts } = await world(t);
    for (let i = 0; i < 3; i++) {
      const p = (await owner.agent.post(`/workspaces/${ws}/posts`).send({ body: `p${i}`, variants: [{ accountId: accounts.linkedin }] })).body.data.id;
      await publish(owner, ws, p);
    }
    await drain(t);
    const p1 = (await owner.agent.get(`/workspaces/${ws}/publications?limit=2&status=published`)).body;
    expect(p1.data).toHaveLength(2);
    const p2 = (await owner.agent.get(`/workspaces/${ws}/publications?limit=2&status=published&cursor=${p1.meta.nextCursor}`)).body;
    expect(p2.data).toHaveLength(1);
    expect((await owner.agent.get(`/workspaces/${ws}/publications?platform=x`)).body.data).toHaveLength(0);
  });
});
