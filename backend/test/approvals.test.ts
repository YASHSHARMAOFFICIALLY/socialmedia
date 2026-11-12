import { describe, it, expect, afterAll } from "vitest";
import { createFakeAdapter, ok } from "./helpers/fake-adapter.js";
import { createTestApp } from "./helpers/app.js";
import { drain, jobs, publish, world, type T, type U } from "./helpers/world.js";

describe("approval workflow (Writer -> Reviewer -> Publisher)", async () => {
  const li = createFakeAdapter("linkedin", () => ok());
  const t = await createTestApp([li.adapter]);
  afterAll(t.close);
  const join = async (ws: string, role: string) => { const u = await t.newUser(role); await t.db.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,$3)", [ws, u.id, role]); return u; };
  const require = (u: U, ws: string, n = 1) => u.agent.put(`/workspaces/${ws}/approval-policy`).send({ required: true, requiredApprovals: n });
  const submit = (u: U, ws: string, post: string) => u.agent.post(`/workspaces/${ws}/posts/${post}/approval-requests`).send({});
  const decide = (u: U, ws: string, id: string, decision: string, comment?: string) => u.agent.post(`/workspaces/${ws}/approval-requests/${id}/decisions`).send({ decision, comment });

  it("without a policy anyone with publish rights can publish; with it, nothing is created until an approved version exists", async () => {
    const free = await world(t);
    expect((await publish(free.owner, free.ws, free.post)).status).toBe(202);
    const w = await world(t);
    expect((await require(w.owner, w.ws)).status).toBe(200);
    const blocked = await publish(w.owner, w.ws, w.post);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("APPROVAL_REQUIRED");
    expect(await jobs(t, w.ws)).toHaveLength(0);                                       // nothing created, nothing queued
    const sched = await w.owner.agent.post(`/workspaces/${w.ws}/posts/${w.post}/schedule`).send({ scheduledAt: new Date(Date.now() + 3600_000).toISOString() });
    expect(sched.body.error.code).toBe("APPROVAL_REQUIRED");                           // scheduling goes through the same gate
  });

  it("full flow: editor submits, admin approves, editor publishes; both sides are notified", async () => {
    const w = await world(t);
    const editor = await join(w.ws, "editor"), admin = await join(w.ws, "admin");
    await require(w.owner, w.ws);
    const sub = await submit(editor, w.ws, w.post);
    expect(sub.status).toBe(201);
    const id = sub.body.data.id;
    expect((await t.db.query("SELECT user_id FROM notifications WHERE type = 'approval_requested' AND workspace_id = $1", [w.ws])).rows.map((r) => (r as { user_id: string }).user_id).sort()).toEqual([w.owner.id, admin.id].sort());   // reviewers, not the author
    expect((await publish(editor, w.ws, w.post)).body.error.code).toBe("APPROVAL_REQUIRED");                          // pending is not approved
    const dec = await decide(admin, w.ws, id, "approved", "ship it");
    expect(dec.body.data).toMatchObject({ status: "approved", decision: "approved" });
    expect((await t.db.query("SELECT body FROM notifications WHERE type = 'approval_decided' AND user_id = $1", [editor.id])).rows).toHaveLength(1);
    const pub = await publish(editor, w.ws, w.post);
    expect(pub.status).toBe(202);
    await drain(t);
    expect((await jobs(t, w.ws))[0]!.status).toBe("published");
    const detail = (await w.owner.agent.get(`/workspaces/${w.ws}/approval-requests/${id}`)).body.data;
    expect(detail.decisions).toHaveLength(1);
    expect((await t.db.query("SELECT 1 FROM audit_logs WHERE workspace_id = $1 AND action IN ('approval.requested','approval.approved')", [w.ws])).rowCount).toBe(2);
  });

  it("separation of duties: no self-approval, only reviewers decide, one vote each, closed requests stay closed", async () => {
    const w = await world(t);
    const editor = await join(w.ws, "editor"), admin = await join(w.ws, "admin"), viewer = await join(w.ws, "viewer"), analyst = await join(w.ws, "analyst");
    await require(w.owner, w.ws, 2);
    const id = (await submit(editor, w.ws, w.post)).body.data.id;
    expect((await decide(editor, w.ws, id, "approved")).status).toBe(403);             // editor lacks approvals:decide
    for (const u of [viewer, analyst]) expect((await decide(u, w.ws, id, "approved")).status).toBe(403);
    const ownReq = await submit(admin, w.ws, (await w.owner.agent.post(`/workspaces/${w.ws}/posts`).send({ body: "mine", variants: [{ accountId: w.accounts.linkedin }] })).body.data.id);
    expect((await decide(admin, w.ws, ownReq.body.data.id, "approved")).body.error.code).toBe("SELF_APPROVAL");
    expect((await decide(admin, w.ws, id, "approved")).body.data.status).toBe("pending");   // 1 of 2
    expect((await decide(admin, w.ws, id, "approved")).body.error.code).toBe("ALREADY_DECIDED");
    expect((await publish(editor, w.ws, w.post)).body.error.code).toBe("APPROVAL_REQUIRED");
    expect((await decide(w.owner, w.ws, id, "approved")).body.data.status).toBe("approved");  // 2 of 2
    expect((await decide(w.owner, w.ws, id, "rejected")).body.error.code).toBe("APPROVAL_CLOSED");
    expect((await publish(editor, w.ws, w.post)).status).toBe(202);
  });

  it("a rejection blocks publishing; the author fixes and resubmits", async () => {
    const w = await world(t);
    const editor = await join(w.ws, "editor"), admin = await join(w.ws, "admin");
    await require(w.owner, w.ws);
    const r1 = (await submit(editor, w.ws, w.post)).body.data.id;
    expect((await submit(editor, w.ws, w.post)).body.error.code).toBe("APPROVAL_ALREADY_PENDING");
    expect((await decide(admin, w.ws, r1, "rejected", "tone")).body.data.status).toBe("rejected");
    expect((await publish(editor, w.ws, w.post)).body.error.code).toBe("APPROVAL_REQUIRED");
    await editor.agent.patch(`/workspaces/${w.ws}/posts/${w.post}`).send({ body: "better copy" });
    const r2 = (await submit(editor, w.ws, w.post)).body.data.id;
    await decide(admin, w.ws, r2, "approved");
    expect((await publish(editor, w.ws, w.post)).status).toBe(202);
  });

  it("an approval covers exactly the version that was reviewed: edits make it stale", async () => {
    const w = await world(t);
    const editor = await join(w.ws, "editor"), admin = await join(w.ws, "admin");
    await require(w.owner, w.ws);
    const r1 = (await submit(editor, w.ws, w.post)).body.data.id;
    await editor.agent.patch(`/workspaces/${w.ws}/posts/${w.post}`).send({ body: "sneaky edit after submission" });
    expect((await w.owner.agent.get(`/workspaces/${w.ws}/approval-requests/${r1}`)).body.data.stale).toBe(true);
    const stale = await decide(admin, w.ws, r1, "approved");
    expect(stale.body.error.code).toBe("STALE_REQUEST");
    expect((await w.owner.agent.get(`/workspaces/${w.ws}/approval-requests/${r1}`)).body.data.status).toBe("cancelled");
    // approve a version, then change it before publishing
    const r2 = (await submit(editor, w.ws, w.post)).body.data.id;
    expect((await decide(admin, w.ws, r2, "approved")).body.data.status).toBe("approved");
    await editor.agent.patch(`/workspaces/${w.ws}/posts/${w.post}`).send({ hashtags: ["changed"] });
    expect((await publish(editor, w.ws, w.post)).body.error.code).toBe("APPROVAL_OUTDATED");
    // variant edits count too
    const w2 = await world(t);
    await require(w2.owner, w2.ws);
    const rr = (await submit(w2.owner, w2.ws, w2.post)).body.data.id;
    const admin2 = await join(w2.ws, "admin");
    await decide(admin2, w2.ws, rr, "approved");
    await w2.owner.agent.put(`/workspaces/${w2.ws}/posts/${w2.post}/variants/${w2.accounts.linkedin}`).send({ caption: "now different" });
    expect((await publish(w2.owner, w2.ws, w2.post)).body.error.code).toBe("APPROVAL_OUTDATED");
  });

  it("only valid content with destinations can be submitted; requests can be withdrawn; isolation", async () => {
    const w = await world(t);
    const editor = await join(w.ws, "editor");
    const empty = (await w.owner.agent.post(`/workspaces/${w.ws}/posts`).send({ body: "no destination" })).body.data.id;
    expect((await submit(editor, w.ws, empty)).status).toBe(422);
    const tooLongForX = (await w.owner.agent.post(`/workspaces/${w.ws}/posts`).send({ body: "a".repeat(400), variants: [{ accountId: w.accounts.linkedin }] })).body.data.id;
    expect((await submit(editor, w.ws, tooLongForX)).status).toBe(201);                 // LinkedIn length is only a warning
    const r = (await submit(editor, w.ws, w.post)).body.data.id;
    const admin = await join(w.ws, "admin");
    expect((await admin.agent.post(`/workspaces/${w.ws}/approval-requests/${r}/cancel`)).status).toBe(204);   // reviewers may withdraw too
    expect((await editor.agent.post(`/workspaces/${w.ws}/approval-requests/${r}/cancel`)).status).toBe(409);
    const stranger = await t.newUser("s");
    for (const x of [await submit(stranger, w.ws, w.post), await stranger.agent.get(`/workspaces/${w.ws}/approval-requests`), await stranger.agent.put(`/workspaces/${w.ws}/approval-policy`).send({ required: true })]) expect(x.status).toBe(404);
    const viewer = await join(w.ws, "viewer");
    expect((await viewer.agent.put(`/workspaces/${w.ws}/approval-policy`).send({ required: false })).status).toBe(403);
    expect((await submit(viewer, w.ws, w.post)).status).toBe(403);
    const other = await world(t);
    expect((await other.owner.agent.get(`/workspaces/${other.ws}/approval-requests/${r}`)).status).toBe(404);
  });
});
