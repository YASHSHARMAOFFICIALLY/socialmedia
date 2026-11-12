import { describe, it, expect, afterAll } from "vitest";
import { purgeOldRows } from "../src/workers/maintenance.js";
import { createTestApp } from "./helpers/app.js";
import { world } from "./helpers/world.js";

describe("housekeeping", async () => {
  const t = await createTestApp([]);
  afterAll(t.close);
  it("removes stale bookkeeping rows and keeps everything still needed", async () => {
    const w = await world(t, []);
    await t.db.query("INSERT INTO idempotency_keys (workspace_id, key, post_id, response, created_at) VALUES ($1,'old',$2,'{}', now() - interval '8 days'), ($1,'new',$2,'{}', now())", [w.ws, w.post]);
    await t.db.query("INSERT INTO rate_limits (key, window_start, count) VALUES ('old', extract(epoch from now())::bigint - 200000, 1), ('new', extract(epoch from now())::bigint, 1)");
    await t.db.query("INSERT INTO oauth_states (state_hash, workspace_id, user_id, platform, expires_at) VALUES ('h1',$1,$2,'x', now() - interval '2 days'), ('h2',$1,$2,'x', now() + interval '5 minutes')", [w.ws, w.owner.id]);
    await t.db.query("INSERT INTO outbox_events (workspace_id, type, aggregate_id, dispatched_at) VALUES ($1,'publish_job',$2, now() - interval '20 days'), ($1,'publish_job',$2, now()), ($1,'publish_job',$2, NULL)", [w.ws, w.post]);
    const r = await purgeOldRows(t.db);
    expect(r).toMatchObject({ idempotencyKeys: 1, rateLimits: 1, oauthStates: 1, outbox: 1 });
    expect((await t.db.query("SELECT key FROM idempotency_keys")).rows).toEqual([{ key: "new" }]);
    expect((await t.db.query("SELECT 1 FROM outbox_events WHERE dispatched_at IS NULL")).rowCount).toBe(1);   // undelivered work is never purged
    expect((await purgeOldRows(t.db))).toMatchObject({ idempotencyKeys: 0, rateLimits: 0, oauthStates: 0, outbox: 0 });   // idempotent
  });
});
