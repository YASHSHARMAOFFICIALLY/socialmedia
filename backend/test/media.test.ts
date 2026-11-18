import { describe, it, expect, afterAll } from "vitest";
import { cleanupAbandonedUploads, purgeDeletedObjects } from "../src/modules/media/media.service.js";
import { imageDimensions, sniffMime } from "../src/modules/media/media.sniff.js";
import { createMemoryStorage, createTestApp } from "./helpers/app.js";

const png = (w: number, h: number) => { const b = new Uint8Array(64); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); new DataView(b.buffer).setUint32(16, w); new DataView(b.buffer).setUint32(20, h); return b; };
const jpeg = (w: number, h: number) => { const b = new Uint8Array(64); b.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xc0, 0, 0x11, 8, h >> 8, h & 255, w >> 8, w & 255, 3]); return b; };
const mp4 = () => { const b = new Uint8Array(64); b.set([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]); return b; };

describe("content sniffing", () => {
  it("identifies real formats from magic bytes and ignores the declared type", () => {
    expect(sniffMime(png(1, 1))).toBe("image/png");
    expect(sniffMime(jpeg(1, 1))).toBe("image/jpeg");
    expect(sniffMime(mp4())).toBe("video/mp4");
    expect(sniffMime(new TextEncoder().encode("GIF89a......"))).toBe("image/gif");
    expect(sniffMime(new TextEncoder().encode("<?php echo 1;"))).toBeNull();
    expect(sniffMime(new TextEncoder().encode("MZ\x90\x00this is an exe"))).toBeNull();
  });
  it("reads dimensions from PNG, GIF and JPEG headers", () => {
    expect(imageDimensions(png(1200, 630), "image/png")).toEqual({ width: 1200, height: 630 });
    expect(imageDimensions(jpeg(1080, 1350), "image/jpeg")).toEqual({ width: 1080, height: 1350 });
    const gif = new Uint8Array(16); gif.set(new TextEncoder().encode("GIF89a")); gif.set([0x40, 0x01, 0xf0, 0x00], 6);
    expect(imageDimensions(gif, "image/gif")).toEqual({ width: 320, height: 240 });
  });
});

describe("media module", async () => {
  const mem = createMemoryStorage();
  const t = await createTestApp([], { storage: mem.storage });
  afterAll(t.close);
  const setup = async () => { const owner = await t.newUser("owner"); const ws = (await owner.agent.post("/workspaces").send({ name: "W" })).body.data.id as string; return { owner, ws }; };
  type U = Awaited<ReturnType<typeof t.newUser>>;
  const upload = async (u: U, ws: string, bytes: Uint8Array, contentType: string, filename = "pic.jpg", sizeBytes = bytes.length) => {
    const r = await u.agent.post(`/workspaces/${ws}/media/uploads`).send({ filename, contentType, sizeBytes });
    if (r.status === 201) mem.put((await t.db.query<{ storage_key: string }>("SELECT storage_key FROM media_assets WHERE id = $1", [r.body.data.media.id])).rows[0]!.storage_key, bytes, contentType);
    return r;
  };

  it("upload flow: presigned PUT → confirm verifies content → ready with dimensions", async () => {
    const { owner, ws } = await setup();
    const up = await upload(owner, ws, jpeg(1080, 1350), "image/jpeg");
    expect(up.status).toBe(201);
    expect(up.body.data.upload).toMatchObject({ method: "PUT", headers: { "Content-Type": "image/jpeg" } });
    expect(up.body.data.media.status).toBe("pending_upload");
    const key = (await t.db.query<{ storage_key: string }>("SELECT storage_key FROM media_assets WHERE id = $1", [up.body.data.media.id])).rows[0]!.storage_key;
    expect(key).toMatch(new RegExp(`^${ws}/[0-9a-f-]{36}\\.jpg$`));        // filename never reaches the key (only a sanitized extension)
    const done = await owner.agent.post(`/workspaces/${ws}/media/${up.body.data.media.id}/confirm`);
    expect(done.body.data).toMatchObject({ status: "ready", width: 1080, height: 1350 });
    expect(JSON.stringify(done.body)).not.toContain("storage_key");
    const detail = await owner.agent.get(`/workspaces/${ws}/media/${up.body.data.media.id}`);
    expect(detail.body.data.downloadUrl).toContain("store.test");
  });

  it("rejects disguised files: declared JPEG that is really a PNG is deleted and marked failed", async () => {
    const { owner, ws } = await setup();
    const up = await upload(owner, ws, png(10, 10), "image/jpeg");
    const id = up.body.data.media.id;
    const badKey = (await t.db.query<{ storage_key: string }>("SELECT storage_key FROM media_assets WHERE id = $1", [id])).rows[0]!.storage_key;
    expect(mem.objects.has(badKey)).toBe(true);
    const r = await owner.agent.post(`/workspaces/${ws}/media/${id}/confirm`);
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("MIME_MISMATCH");
    expect((await t.db.query("SELECT status FROM media_assets WHERE id = $1", [id])).rows[0]).toEqual({ status: "failed" });
    expect(mem.objects.has(badKey)).toBe(false);                            // the rejected object was deleted
    const exe = await upload(owner, ws, new TextEncoder().encode("MZ\x90 not an image at all, padded padded"), "image/png");
    expect((await owner.agent.post(`/workspaces/${ws}/media/${exe.body.data.media.id}/confirm`)).body.error.code).toBe("MIME_MISMATCH");
  });

  it("rejects size mismatches and missing uploads", async () => {
    const { owner, ws } = await setup();
    const none = await owner.agent.post(`/workspaces/${ws}/media/uploads`).send({ filename: "a.png", contentType: "image/png", sizeBytes: 100 });
    expect((await owner.agent.post(`/workspaces/${ws}/media/${none.body.data.media.id}/confirm`)).body.error.code).toBe("UPLOAD_MISSING");
    const lie = await upload(owner, ws, png(5, 5), "image/png", "a.png", 999);
    expect((await owner.agent.post(`/workspaces/${ws}/media/${lie.body.data.media.id}/confirm`)).body.error.code).toBe("SIZE_MISMATCH");
  });

  it("validates upload requests: allowed types, size caps, safe filenames", async () => {
    const { owner, ws } = await setup();
    const bad = (body: object) => owner.agent.post(`/workspaces/${ws}/media/uploads`).send(body);
    expect((await bad({ filename: "a.exe", contentType: "application/x-msdownload", sizeBytes: 10 })).status).toBe(400);
    expect((await bad({ filename: "a.jpg", contentType: "image/jpeg", sizeBytes: 26 * 1024 * 1024 })).status).toBe(400);
    expect((await bad({ filename: "a.mp4", contentType: "video/mp4", sizeBytes: 5 * 1024 ** 3 })).status).toBe(400);
    expect((await bad({ filename: "../../etc/passwd", contentType: "image/png", sizeBytes: 10 })).status).toBe(400);
    expect((await bad({ filename: "a.jpg", contentType: "image/jpeg", sizeBytes: 0 })).status).toBe(400);
  });

  it("tenant isolation and RBAC", async () => {
    const { owner, ws } = await setup();
    const up = await upload(owner, ws, png(3, 3), "image/png", "a.png");
    const id = up.body.data.media.id;
    const stranger = await t.newUser("s");
    for (const r of [await stranger.agent.get(`/workspaces/${ws}/media/${id}`), await stranger.agent.post(`/workspaces/${ws}/media/${id}/confirm`), await stranger.agent.delete(`/workspaces/${ws}/media/${id}`), await stranger.agent.get(`/workspaces/${ws}/media`)])
      expect(r.status).toBe(404);
    const other = await setup();
    expect((await other.owner.agent.get(`/workspaces/${other.ws}/media/${id}`)).status).toBe(404);   // id from another workspace
    const viewer = await t.newUser("v");
    await t.db.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'viewer')", [ws, viewer.id]);
    expect((await viewer.agent.get(`/workspaces/${ws}/media`)).status).toBe(200);
    expect((await viewer.agent.post(`/workspaces/${ws}/media/uploads`).send({ filename: "a.png", contentType: "image/png", sizeBytes: 5 })).status).toBe(403);
    expect((await viewer.agent.delete(`/workspaces/${ws}/media/${id}`)).status).toBe(403);
  });

  it("library: filter, search, usage tracking; in-use assets cannot be deleted, unused ones can (object removed too)", async () => {
    const { owner, ws } = await setup();
    const a = (await upload(owner, ws, png(4, 4), "image/png", "banner.png")).body.data.media.id;
    const b = (await upload(owner, ws, mp4(), "video/mp4", "clip.mp4")).body.data.media.id;
    for (const id of [a, b]) await owner.agent.post(`/workspaces/${ws}/media/${id}/confirm`);
    const post = (await owner.agent.post(`/workspaces/${ws}/posts`).send({ body: "x", media: [{ mediaId: a }] })).body.data.id;
    expect(post).toBeTruthy();
    const get = (qs: string) => owner.agent.get(`/workspaces/${ws}/media${qs}`).then((r) => r.body.data as { id: string; usage_count: number }[]);
    expect((await get("?kind=video")).map((m) => m.id)).toEqual([b]);
    expect((await get("?q=BANNER")).map((m) => m.id)).toEqual([a]);
    expect((await get("?unused=true")).map((m) => m.id)).toEqual([b]);
    expect((await get("")).find((m) => m.id === a)!.usage_count).toBe(1);
    expect((await owner.agent.delete(`/workspaces/${ws}/media/${a}`)).body.error.code).toBe("MEDIA_IN_USE");
    const key = (await t.db.query<{ storage_key: string }>("SELECT storage_key FROM media_assets WHERE id = $1", [b])).rows[0]!.storage_key;
    expect(mem.objects.has(key)).toBe(true);
    expect((await owner.agent.delete(`/workspaces/${ws}/media/${b}`)).status).toBe(204);
    expect(mem.objects.has(key)).toBe(false);
    expect((await get("")).map((m) => m.id)).toEqual([a]);
  });

  it("per-platform compatibility: the same file is not assumed valid everywhere", async () => {
    const { owner, ws } = await setup();
    const png1 = (await upload(owner, ws, png(100, 100), "image/png", "a.png")).body.data.media.id;
    const mov = (await upload(owner, ws, (() => { const b = mp4(); b.set([0x71, 0x74, 0x20, 0x20], 8); return b; })(), "video/quicktime", "a.mov")).body.data.media.id;
    for (const id of [png1, mov]) await owner.agent.post(`/workspaces/${ws}/media/${id}/confirm`);
    const img = (await owner.agent.get(`/workspaces/${ws}/media/${png1}/compatibility`)).body.data;
    expect(img.linkedin.compatible).toBe(true);
    expect(img.x.compatible).toBe(true);
    expect(img.instagram.compatible).toBe(false);          // JPEG only
    expect(img.youtube.compatible).toBe(false);            // needs a video
    const vid = (await owner.agent.get(`/workspaces/${ws}/media/${mov}/compatibility`)).body.data;
    expect(vid.linkedin.compatible).toBe(false);           // MP4 only
    expect(vid.youtube.compatible).toBe(true);
  });

  it("deleting a workspace removes its stored objects too (queued in the same transaction, drained by housekeeping)", async () => {
    const { owner, ws } = await setup();
    const id = (await upload(owner, ws, png(3, 3), "image/png", "gone.png")).body.data.media.id;
    await owner.agent.post(`/workspaces/${ws}/media/${id}/confirm`);
    const key = (await t.db.query<{ storage_key: string }>("SELECT storage_key FROM media_assets WHERE id = $1", [id])).rows[0]!.storage_key;
    expect(mem.objects.has(key)).toBe(true);
    expect((await owner.agent.delete(`/workspaces/${ws}`).send({ confirmName: "W" })).status).toBe(204);
    expect(await purgeDeletedObjects(t.db, mem.storage)).toBeGreaterThanOrEqual(1);
    expect(mem.objects.has(key)).toBe(false);
    expect((await t.db.query("SELECT 1 FROM storage_deletions WHERE storage_key = $1", [key])).rowCount).toBe(0);
  });

  it("cleanup removes stale unconfirmed uploads but never attached or fresh ones", async () => {
    const { owner, ws } = await setup();
    const stale = (await upload(owner, ws, png(2, 2), "image/png", "s.png")).body.data.media.id;
    const fresh = (await upload(owner, ws, png(2, 2), "image/png", "f.png")).body.data.media.id;
    await t.db.query("UPDATE media_assets SET created_at = now() - interval '2 days' WHERE id = $1", [stale]);
    expect(await cleanupAbandonedUploads(t.db, mem.storage, 24)).toBe(1);
    expect((await t.db.query("SELECT id FROM media_assets WHERE id = ANY($1::uuid[])", [[stale, fresh]])).rows.map((r) => (r as { id: string }).id)).toEqual([fresh]);
  });

  it("without storage configured, media endpoints say so instead of failing mysteriously", async () => {
    const t2 = await createTestApp([], { storage: null });
    const u = await t2.newUser("o"); const ws = (await u.agent.post("/workspaces").send({ name: "W" })).body.data.id;
    const r = await u.agent.post(`/workspaces/${ws}/media/uploads`).send({ filename: "a.png", contentType: "image/png", sizeBytes: 5 });
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe("MEDIA_STORAGE_NOT_CONFIGURED");
    await t2.close();
  });
});
