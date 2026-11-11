import { describe, it, expect, afterAll } from "vitest";
import { PlatformError } from "../src/integrations/core/errors.js";
import type { Mailer } from "../src/infrastructure/email/resend.js";
import { createFakeAdapter, ok } from "./helpers/fake-adapter.js";
import { createTestApp } from "./helpers/app.js";
import { drain, jobs, publish, world, type T } from "./helpers/world.js";

const notes = (t: T, userId: string, type?: string) => t.db.query<{ type: string; title: string; body: string }>("SELECT type, title, body FROM notifications WHERE user_id = $1 AND ($2::text IS NULL OR type = $2) ORDER BY created_at", [userId, type ?? null]).then((r) => r.rows);
const emails = (t: T) => t.db.query<{ attempts: number; dispatched_at: string | null }>("SELECT attempts, dispatched_at FROM outbox_events WHERE type = 'notification_email' ORDER BY id").then((r) => r.rows);

describe("notifications", async () => {
  let failMode: "ok" | "fail" = "ok";
  const sentMail: { to: string; subject: string; html: string }[] = [];
  const mailer: Mailer = { send: async (m) => { if (failMode === "fail") throw new Error("smtp down"); sentMail.push(m); } };
  let result: "ok" | "fail" | "perm" = "ok";
  const li = createFakeAdapter("linkedin", () => { if (result === "fail") throw new PlatformError("permanent", "Rejected <b>by</b> LinkedIn"); return ok(); });
  const t = await createTestApp([li.adapter], { mailer });
  afterAll(t.close);

  it("a failed publication notifies its author in-app AND by email (asynchronously, exactly once)", async () => {
    result = "fail";
    const w = await world(t, ["linkedin"], "Launch post");
    await publish(w.owner, w.ws, w.post);
    await drain(t);
    expect((await jobs(t, w.ws))[0]!.status).toBe("failed");
    expect(await notes(t, w.owner.id)).toHaveLength(0);                         // nothing is created inside the publishing transaction
    const rep = await t.deps.engine.notifications.sweep();
    expect(rep.published).toBe(1);
    const [n] = await notes(t, w.owner.id, "publish_failed");
    expect(n!.title).toMatch(/linkedin failed/i);
    expect(n!.body).toContain("Rejected");
    expect(sentMail).toHaveLength(1);
    expect(sentMail[0]!.to).toBe(w.owner.email);
    expect(sentMail[0]!.html).not.toContain("<b>by</b>");                      // user/platform text is HTML-escaped
    expect(sentMail[0]!.html).toContain("&lt;b&gt;by&lt;/b&gt;");
    await t.deps.engine.notifications.sweep();
    await t.deps.engine.notifications.sweep();
    expect(await notes(t, w.owner.id, "publish_failed")).toHaveLength(1);       // cursor + unique ref => no duplicates
    expect(sentMail).toHaveLength(1);
  });

  it("success is in-app only by default; preferences switch channels per type", async () => {
    result = "ok"; sentMail.length = 0;
    const w = await world(t, ["linkedin"], "Good post");
    await publish(w.owner, w.ws, w.post); await drain(t);
    await t.deps.engine.notifications.sweep();
    expect(await notes(t, w.owner.id, "publish_succeeded")).toHaveLength(1);
    expect(sentMail).toHaveLength(0);
    const prefs = (await w.owner.agent.get(`/workspaces/${w.ws}/notification-preferences`)).body.data;
    expect(prefs.find((p: { type: string }) => p.type === "publish_succeeded")).toMatchObject({ inApp: true, email: false });
    expect(prefs.find((p: { type: string }) => p.type === "publish_failed")).toMatchObject({ inApp: true, email: true });
    const set = await w.owner.agent.put(`/workspaces/${w.ws}/notification-preferences`).send({ preferences: [{ type: "publish_succeeded", inApp: true, email: true }, { type: "publish_failed", inApp: false, email: false }] });
    expect(set.status).toBe(200);
    expect(set.body.data.find((p: { type: string }) => p.type === "publish_succeeded").email).toBe(true);
    const w2 = await world(t, ["linkedin"], "second");   // different workspace = different preference scope
    expect((await w2.owner.agent.get(`/workspaces/${w2.ws}/notification-preferences`)).body.data.find((p: { type: string }) => p.type === "publish_succeeded").email).toBe(false);
    const p2 = (await w.owner.agent.post(`/workspaces/${w.ws}/posts`).send({ body: "again", variants: [{ accountId: w.accounts.linkedin }] })).body.data.id;
    await publish(w.owner, w.ws, p2); await drain(t); await t.deps.engine.notifications.sweep();
    expect(sentMail.map((m) => m.subject)).toEqual(["Published on linkedin"]);
    result = "fail";
    const p3 = (await w.owner.agent.post(`/workspaces/${w.ws}/posts`).send({ body: "fails", variants: [{ accountId: w.accounts.linkedin }] })).body.data.id;
    await publish(w.owner, w.ws, p3); await drain(t); await t.deps.engine.notifications.sweep();
    expect(await notes(t, w.owner.id, "publish_failed")).toHaveLength(0);       // muted entirely
    expect((await w.owner.agent.put(`/workspaces/${w.ws}/notification-preferences`).send({ preferences: [{ type: "nope", inApp: true, email: true }] })).status).toBe(400);
    result = "ok";
  });

  it("email delivery failures back off exponentially and stop after 5 tries; the in-app notification still exists", async () => {
    result = "fail"; failMode = "fail"; sentMail.length = 0;
    const w = await world(t, ["linkedin"], "mail trouble");
    await publish(w.owner, w.ws, w.post); await drain(t);
    await t.deps.engine.notifications.sweep();
    let [e] = await emails(t).then((r) => r.slice(-1));
    expect(e).toMatchObject({ dispatched_at: null });
    for (let i = 0; i < 6; i++) { await t.db.query("UPDATE outbox_events SET available_at = now() - interval '1s' WHERE type = 'notification_email' AND dispatched_at IS NULL"); await t.deps.engine.notifications.sweep(); }
    [e] = await emails(t).then((r) => r.slice(-1));
    expect(e!.attempts).toBe(5);
    expect(e!.dispatched_at).not.toBeNull();                                   // gave up
    expect(sentMail).toHaveLength(0);
    expect(await notes(t, w.owner.id, "publish_failed")).toHaveLength(1);
    failMode = "ok"; result = "ok";
  });

  it("missed scheduled posts, expired and expiring connections are announced to the people who can fix them", async () => {
    sentMail.length = 0;
    const w = await world(t, ["linkedin"], "scheduled");
    const admin = await t.newUser("admin"); const viewer = await t.newUser("viewer");
    await t.db.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'admin'),($1,$3,'viewer')", [w.ws, admin.id, viewer.id]);
    await w.owner.agent.post(`/workspaces/${w.ws}/posts/${w.post}/schedule`).send({ scheduledAt: new Date(Date.now() + 3600_000).toISOString() });
    await t.db.query("UPDATE publishing_jobs SET next_attempt_at = now() - interval '8 hours'; UPDATE outbox_events SET available_at = now() - interval '8 hours'");
    await t.deps.engine.sweep();
    await t.deps.engine.notifications.sweep();
    expect((await notes(t, w.owner.id, "publish_failed"))[0]!.body).toMatch(/scheduled time passed/);
    // connection problems
    await t.db.query("UPDATE social_accounts SET status = 'needs_reauth' WHERE id = $1", [w.accounts.linkedin]);
    await t.deps.engine.notifications.sweep(); await t.deps.engine.notifications.sweep();
    for (const u of [w.owner, admin]) expect(await notes(t, u.id, "account_reauth_required")).toHaveLength(1);
    expect(await notes(t, viewer.id, "account_reauth_required")).toHaveLength(0);          // viewers cannot reconnect accounts
    await t.db.query("UPDATE social_accounts SET status = 'active' WHERE id = $1", [w.accounts.linkedin]);
    await t.db.query("UPDATE oauth_credentials SET expires_at = now() + interval '2 days', refresh_token_enc = NULL WHERE social_account_id = $1", [w.accounts.linkedin]);
    await t.deps.engine.notifications.sweep();
    expect((await notes(t, w.owner.id, "account_expiring"))[0]!.title).toMatch(/expires soon/);
  });

  it("API: users see only their own notifications; read state, unread count, pagination, isolation", async () => {
    result = "ok";
    const w = await world(t, ["linkedin"], "inbox");
    const admin = await t.newUser("admin2");
    await t.db.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'admin')", [w.ws, admin.id]);
    for (let i = 0; i < 3; i++) await t.db.query("INSERT INTO notifications (workspace_id, user_id, type, title, body, ref) VALUES ($1,$2,'publish_succeeded',$3,'b',$4)", [w.ws, w.owner.id, `n${i}`, `r${i}`]);
    await t.db.query("INSERT INTO notifications (workspace_id, user_id, type, title, body, ref) VALUES ($1,$2,'publish_succeeded','admin only','b','x')", [w.ws, admin.id]);
    const list = await w.owner.agent.get(`/workspaces/${w.ws}/notifications?limit=2`);
    expect(list.body.data).toHaveLength(2);
    expect(list.body.meta.unread).toBe(3);
    const more = await w.owner.agent.get(`/workspaces/${w.ws}/notifications?limit=2&cursor=${list.body.meta.nextCursor}`);
    expect(more.body.data).toHaveLength(1);
    expect(JSON.stringify([list.body, more.body])).not.toContain("admin only");
    const id = list.body.data[0].id;
    expect((await admin.agent.post(`/workspaces/${w.ws}/notifications/${id}/read`)).status).toBe(404);   // someone else's notification
    expect((await w.owner.agent.post(`/workspaces/${w.ws}/notifications/${id}/read`)).status).toBe(204);
    expect((await w.owner.agent.get(`/workspaces/${w.ws}/notifications?unread=true`)).body.data).toHaveLength(2);
    expect((await w.owner.agent.post(`/workspaces/${w.ws}/notifications/read-all`)).body.data.updated).toBe(2);
    expect((await w.owner.agent.get(`/workspaces/${w.ws}/notifications?unread=true`)).body.data).toHaveLength(0);
    const stranger = await t.newUser("s");
    expect((await stranger.agent.get(`/workspaces/${w.ws}/notifications`)).status).toBe(404);
    expect((await admin.agent.get(`/workspaces/${w.ws}/notifications`)).body.meta.unread).toBe(1);
  });
});

describe("notification producer lag", async () => {
  const t = await createTestApp([createFakeAdapter("linkedin", () => ok()).adapter], { env: { NOTIFY_PRODUCER_LAG_S: "3600" } });
  afterAll(t.close);
  it("does not read events younger than the lag (a still-open transaction's lower id could otherwise be skipped forever), then picks them up", async () => {
    const w = await world(t, ["linkedin"]);
    await publish(w.owner, w.ws, w.post);
    await drain(t);
    expect((await t.deps.engine.notifications.sweep()).published).toBe(0);
    await t.db.query("UPDATE publishing_events SET created_at = now() - interval '2 hours'");
    expect((await t.deps.engine.notifications.sweep()).published).toBe(1);
  });
});
