import { describe, it, expect, afterAll } from "vitest";
import { createLinkedInAdapter } from "../src/integrations/linkedin/linkedin.adapter.js";
import { createTestApp } from "./helpers/app.js";

describe("content management", async () => {
  const t = await createTestApp([createLinkedInAdapter({ clientId: "c", clientSecret: "s" })]);
  afterAll(t.close);
  type U = Awaited<ReturnType<typeof t.newUser>>;

  async function setup() {
    const owner = await t.newUser("owner");
    const ws = (await owner.agent.post("/workspaces").send({ name: "W" })).body.data.id as string;
    return { owner, ws, ...(await seed(ws, owner)) };
  }
  async function seed(ws: string, user: U) {
    const acct = async (platform: string, status = "active") =>
      (await t.db.query<{ id: string }>(
        "INSERT INTO social_accounts (workspace_id, platform, external_id, display_name, account_type, connected_by, status) VALUES ($1,$2,$3,$4,'personal',$5,$6) RETURNING id",
        [ws, platform, `${platform}-${Math.random()}`, `${platform} acct`, user.id, status])).rows[0]!.id;
    const media = async (workspaceId: string, kind: "image" | "video", mime: string) =>
      (await t.db.query<{ id: string }>(
        "INSERT INTO media_assets (workspace_id, kind, storage_key, filename, mime_type, size_bytes, status, created_by) VALUES ($1,$2,$3,$4,$5,200000,'ready',$6) RETURNING id",
        [workspaceId, kind, `k/${Math.random()}`, `f.${kind}`, mime, user.id])).rows[0]!.id;
    return { acct, media: (kind: "image" | "video" = "image", mime = kind === "image" ? "image/jpeg" : "video/mp4") => media(ws, kind, mime), mediaIn: media };
  }
  const post = (u: U, ws: string, body: unknown) => u.agent.post(`/workspaces/${ws}/posts`).send(body as object);

  it("creates a draft with post-level media, hashtags normalized, and per-platform variants", async () => {
    const { owner, ws, acct, media } = await setup();
    const li = await acct("linkedin"), x = await acct("x"), m = await media();
    const r = await post(owner, ws, {
      title: "Launch", body: "Big news!", hashtags: ["#launch", "news"], labels: ["q4"], media: [{ mediaId: m }],
      variants: [{ accountId: li, caption: "Professional tone" }, { accountId: x, caption: "Short tone", hashtags: [] }],
    });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ status: "draft", hashtags: ["launch", "news"], labels: ["q4"] });
    expect(r.body.data.variants.map((v: { platform: string }) => v.platform).sort()).toEqual(["linkedin", "x"]);
    expect(r.body.data.media).toHaveLength(1);
  });

  it("rejects foreign / unknown accounts and media (tenant isolation on references)", async () => {
    const a = await setup(), b = await setup();
    const foreignAcct = await b.acct("x"), foreignMedia = await b.media();
    expect((await post(a.owner, a.ws, { variants: [{ accountId: foreignAcct }] })).status).toBe(400);
    expect((await post(a.owner, a.ws, { media: [{ mediaId: foreignMedia }] })).status).toBe(400);
    const own = await post(a.owner, a.ws, { body: "x" });
    expect((await a.owner.agent.put(`/workspaces/${a.ws}/posts/${own.body.data.id}/variants/${foreignAcct}`).send({})).status).toBe(400);
    expect((await a.owner.agent.patch(`/workspaces/${a.ws}/posts/${own.body.data.id}`).send({ media: [{ mediaId: foreignMedia }] })).status).toBe(400);
  });

  it("isolation + RBAC: strangers get 404, viewers can read but not write", async () => {
    const { owner, ws } = await setup();
    const p = (await post(owner, ws, { body: "secret" })).body.data.id;
    const stranger = await t.newUser("s");
    for (const r of [await stranger.agent.get(`/workspaces/${ws}/posts/${p}`), await stranger.agent.get(`/workspaces/${ws}/posts`), await post(stranger, ws, {}), await stranger.agent.delete(`/workspaces/${ws}/posts/${p}`)])
      expect(r.status).toBe(404);
    const viewer = await t.newUser("v");
    await t.db.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'viewer')", [ws, viewer.id]);
    expect((await viewer.agent.get(`/workspaces/${ws}/posts/${p}`)).status).toBe(200);
    expect((await post(viewer, ws, {})).status).toBe(403);
    expect((await viewer.agent.patch(`/workspaces/${ws}/posts/${p}`).send({ body: "x" })).status).toBe(403);
    // a post id from workspace A is not reachable through workspace B's URL
    const other = await setup();
    expect((await other.owner.agent.get(`/workspaces/${other.ws}/posts/${p}`)).status).toBe(404);
  });

  it("edits and deletes drafts only; submitted posts are immutable", async () => {
    const { owner, ws } = await setup();
    const p = (await post(owner, ws, { body: "v1", labels: ["a"] })).body.data.id;
    const upd = await owner.agent.patch(`/workspaces/${ws}/posts/${p}`).send({ body: "v2", title: null });
    expect(upd.body.data).toMatchObject({ body: "v2", title: null, labels: ["a"] });
    await t.db.query("UPDATE posts SET status = 'submitted' WHERE id = $1", [p]);
    expect((await owner.agent.patch(`/workspaces/${ws}/posts/${p}`).send({ body: "v3" })).body.error.code).toBe("POST_NOT_EDITABLE");
    expect((await owner.agent.delete(`/workspaces/${ws}/posts/${p}`)).status).toBe(409);
    const d = (await post(owner, ws, {})).body.data.id;
    expect((await owner.agent.delete(`/workspaces/${ws}/posts/${d}`)).status).toBe(204);
    expect((await owner.agent.get(`/workspaces/${ws}/posts/${d}`)).status).toBe(404);
  });

  it("duplicates a post with variants and media as a new draft", async () => {
    const { owner, ws, acct, media } = await setup();
    const x = await acct("x"), m1 = await media(), m2 = await media();
    const src = (await post(owner, ws, { title: "T", body: "B", media: [{ mediaId: m1 }], variants: [{ accountId: x, caption: "c", media: [{ mediaId: m2 }] }] })).body.data;
    const copy = (await owner.agent.post(`/workspaces/${ws}/posts/${src.id}/duplicate`)).body.data;
    expect(copy.id).not.toBe(src.id);
    expect(copy).toMatchObject({ title: "T (copy)", body: "B", status: "draft" });
    expect(copy.media).toHaveLength(1);
    expect(copy.variants[0]).toMatchObject({ accountId: x, caption: "c" });
    expect(copy.variants[0].media).toHaveLength(1);
  });

  it("variant upsert/remove; duplicate destinations rejected", async () => {
    const { owner, ws, acct } = await setup();
    const x = await acct("x");
    const p = (await post(owner, ws, {})).body.data.id;
    expect((await owner.agent.put(`/workspaces/${ws}/posts/${p}/variants/${x}`).send({ caption: "one" })).body.data.variants).toHaveLength(1);
    const again = await owner.agent.put(`/workspaces/${ws}/posts/${p}/variants/${x}`).send({ caption: "two" });
    expect(again.body.data.variants).toHaveLength(1);
    expect(again.body.data.variants[0].caption).toBe("two");
    expect((await owner.agent.delete(`/workspaces/${ws}/posts/${p}/variants/${x}`)).status).toBe(204);
    expect((await owner.agent.delete(`/workspaces/${ws}/posts/${p}/variants/${x}`)).status).toBe(404);
    expect((await post(owner, ws, { variants: [{ accountId: x }, { accountId: x }] })).status).toBe(400);
  });

  it("lists with filters, text search (wildcards escaped) and keyset pagination", async () => {
    const { owner, ws } = await setup();
    for (const [title, label] of [["Alpha", "a"], ["Beta 100%", "b"], ["Gamma", "a"]]) await post(owner, ws, { title, labels: [label] });
    const get = (qs: string) => owner.agent.get(`/workspaces/${ws}/posts${qs}`);
    expect((await get("?label=a")).body.data.map((p: { title: string }) => p.title).sort()).toEqual(["Alpha", "Gamma"]);
    expect((await get("?q=100%25")).body.data.map((p: { title: string }) => p.title)).toEqual(["Beta 100%"]);
    expect((await get("?q=%25")).body.data).toHaveLength(1); // '%' is literal, not a wildcard
    const p1 = (await get("?limit=2")).body;
    expect(p1.data).toHaveLength(2);
    const p2 = (await get(`?limit=2&cursor=${p1.meta.nextCursor}`)).body;
    expect(p2.data).toHaveLength(1);
    expect(new Set([...p1.data, ...p2.data].map((p: { id: string }) => p.id)).size).toBe(3);
  });

  it("validate: per-platform errors, warnings, and honest publish blockers", async () => {
    const { owner, ws, acct, media } = await setup();
    const li = await acct("linkedin"), x = await acct("x"), yt = await acct("youtube"), ig = await acct("instagram"), vid = await media("video");
    const p = (await post(owner, ws, {
      body: "a".repeat(300), media: [{ mediaId: vid }],
      variants: [{ accountId: li }, { accountId: x }, { accountId: yt, title: "My video" }, { accountId: ig }],
    })).body.data.id;
    const rep = (await owner.agent.post(`/workspaces/${ws}/posts/${p}/validate`)).body.data;
    const by = (platform: string) => rep.variants.find((v: { platform: string }) => v.platform === platform);
    expect(by("x").valid).toBe(false);
    expect(by("x").issues.map((i: { code: string }) => i.code)).toContain("TEXT_TOO_LONG");
    expect(by("youtube").valid).toBe(true);
    expect(by("linkedin").valid).toBe(true);
    expect(by("instagram").valid).toBe(true);
    expect(rep.valid).toBe(false);
    // LinkedIn is configured with verified capabilities; the other platforms have no adapter configured
    expect(by("linkedin").publishable).toBe(true);
    expect(by("youtube").publishBlockers.join()).toMatch(/not configured/);
    expect(by("x").publishBlockers.join()).toMatch(/not configured/);
    expect(rep.publishable).toBe(false);
  });

  it("validate: variant media overrides post media; disconnected/needs_reauth accounts block publishing", async () => {
    const { owner, ws, acct, media } = await setup();
    const yt = await acct("youtube", "needs_reauth"), img = await media("image"), vid = await media("video");
    const p = (await post(owner, ws, { media: [{ mediaId: img }], variants: [{ accountId: yt, title: "t", media: [{ mediaId: vid }] }] })).body.data.id;
    const v = (await owner.agent.post(`/workspaces/${ws}/posts/${p}/validate`)).body.data.variants[0];
    expect(v.valid).toBe(true);                       // the video override satisfies YouTube
    expect(v.publishBlockers.join()).toMatch(/needs_reauth/);
    const empty = (await post(owner, ws, {})).body.data.id;
    expect((await owner.agent.post(`/workspaces/${ws}/posts/${empty}/validate`)).body.data.issues[0].code).toBe("NO_DESTINATIONS");
  });

  it("rejects malformed input", async () => {
    const { owner, ws } = await setup();
    expect((await post(owner, ws, { hashtags: ["bad tag!"] })).status).toBe(400);
    expect((await post(owner, ws, { media: [{ mediaId: "nope" }] })).status).toBe(400);
    expect((await owner.agent.patch(`/workspaces/${ws}/posts/00000000-0000-0000-0000-000000000000`).send({})).status).toBe(400);
  });
});
