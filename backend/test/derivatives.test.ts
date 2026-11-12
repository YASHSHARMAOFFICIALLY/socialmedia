import { describe, it, expect, afterAll } from "vitest";
import { createR2Storage } from "../src/infrastructure/storage/storage.js";
import type { ImageTransformer } from "../src/infrastructure/storage/image-transform.js";
import { createMemoryStorage, createTestApp } from "./helpers/app.js";
import { world } from "./helpers/world.js";

const png = (w: number, h: number) => { const b = new Uint8Array(64); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); new DataView(b.buffer).setUint32(16, w); new DataView(b.buffer).setUint32(20, h); return b; };
const jpeg = (w: number, h: number) => { const b = new Uint8Array(64); b.set([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xc0, 0, 0x11, 8, h >> 8, h & 255, w >> 8, w & 255, 3]); return b; };

describe("signed server-side upload (R2 PUT)", () => {
  it("signs the body hash and content type", async () => {
    let seen: { headers: Record<string, string>; method: string } | undefined;
    const f = (async (_u: string, init: RequestInit) => { seen = { method: init.method!, headers: Object.fromEntries(new Headers(init.headers).entries()) }; return new Response(null, { status: 200 }); }) as unknown as typeof fetch;
    await createR2Storage({ accountId: "a", accessKeyId: "AK", secretAccessKey: "SK", bucket: "b" }, f).put("k/x.jpg", new Uint8Array([1, 2, 3]), "image/jpeg");
    expect(seen!.method).toBe("PUT");
    expect(seen!.headers["content-type"]).toBe("image/jpeg");
    expect(seen!.headers["x-amz-content-sha256"]).toBe("039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81");   // sha256 of bytes 01 02 03
    expect(seen!.headers.authorization).toMatch(/SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date/);
  });
});

describe("image derivatives", async () => {
  const mem = createMemoryStorage();
  let mode: "ok" | "wrong-type" | "fail" = "ok";
  const calls: { url: string; format: string; width?: number | undefined }[] = [];
  const images: ImageTransformer = { transform: async (url, o) => { calls.push({ url, format: o.format, width: o.width }); if (mode === "fail") throw new Error("boom"); return mode === "wrong-type" ? { bytes: png(5, 5), contentType: "image/png" } : { bytes: jpeg(o.width ?? 800, 450), contentType: "image/jpeg" }; } };
  const t = await createTestApp([], { storage: mem.storage, images });
  const none = await createTestApp([], { storage: mem.storage, images: null });
  afterAll(async () => { await t.close(); await none.close(); });
  const readyPng = async (app: typeof t, u: Awaited<ReturnType<typeof t.newUser>>, ws: string) => {
    const up = await u.agent.post(`/workspaces/${ws}/media/uploads`).send({ filename: "logo.png", contentType: "image/png", sizeBytes: 64 });
    const key = (await app.db.query<{ storage_key: string }>("SELECT storage_key FROM media_assets WHERE id = $1", [up.body.data.media.id])).rows[0]!.storage_key;
    mem.put(key, png(1920, 1080), "image/png");
    await u.agent.post(`/workspaces/${ws}/media/${up.body.data.media.id}/confirm`);
    return up.body.data.media.id as string;
  };

  it("converts an image for a platform that needs another format; the copy is a verified, linked asset", async () => {
    const w = await world(t, []);
    const id = await readyPng(t, w.owner, w.ws);
    const before = (await w.owner.agent.get(`/workspaces/${w.ws}/media/${id}/compatibility`)).body.data;
    expect(before.instagram.compatible).toBe(false);
    expect(before.instagram.fixes[0]).toMatchObject({ action: "create_derivative", format: "jpeg" });
    const r = await w.owner.agent.post(`/workspaces/${w.ws}/media/${id}/derivatives`).send({ format: "jpeg", maxWidth: 1080 });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ kind: "image", mime_type: "image/jpeg", status: "ready", width: 1080, height: 450, filename: "logo.jpg" });
    expect(calls.at(-1)).toMatchObject({ format: "jpeg", width: 1080 });
    expect(calls.at(-1)!.url).toContain("expires=300");   // the source is handed over as a short-lived (5 minute) signed URL
    const row = (await t.db.query<{ derived_from: string; storage_key: string }>("SELECT derived_from, storage_key FROM media_assets WHERE id = $1", [r.body.data.id])).rows[0]!;
    expect(row.derived_from).toBe(id);
    expect(mem.objects.has(row.storage_key)).toBe(true);
    expect(mem.objects.get(row.storage_key)!.contentType).toBe("image/jpeg");
    const after = (await w.owner.agent.get(`/workspaces/${w.ws}/media/${r.body.data.id}/compatibility`)).body.data;
    expect(after.instagram.compatible).toBe(true);                                           // now usable for Instagram
    expect((await w.owner.agent.get(`/workspaces/${w.ws}/media/${id}`)).body.data.mime_type).toBe("image/png");   // original untouched
  });

  it("verifies the transformer's output instead of trusting it, and reports failures safely", async () => {
    const w = await world(t, []);
    const id = await readyPng(t, w.owner, w.ws);
    mode = "wrong-type";
    const bad = await w.owner.agent.post(`/workspaces/${w.ws}/media/${id}/derivatives`).send({ format: "jpeg" });
    expect(bad.status).toBe(502);
    expect(bad.body.error.code).toBe("IMAGE_TRANSFORM_FAILED");
    mode = "fail";
    const failed = await w.owner.agent.post(`/workspaces/${w.ws}/media/${id}/derivatives`).send({ format: "jpeg" });
    expect(JSON.stringify(failed.body)).not.toContain("boom");
    mode = "ok";
    expect((await t.db.query("SELECT 1 FROM media_assets WHERE workspace_id = $1 AND derived_from IS NOT NULL", [w.ws])).rowCount).toBe(0);   // nothing half-created
  });

  it("is unavailable (503) without the transformation feature, refuses videos/unconfirmed files, validates input, enforces permissions and tenancy", async () => {
    const w = await world(none, []);
    const id = await readyPng(none, w.owner, w.ws);
    expect((await w.owner.agent.post(`/workspaces/${w.ws}/media/${id}/derivatives`).send({ format: "jpeg" })).body.error.code).toBe("IMAGE_TRANSFORM_UNAVAILABLE");
    const w2 = await world(t, []);
    const pending = (await w2.owner.agent.post(`/workspaces/${w2.ws}/media/uploads`).send({ filename: "a.png", contentType: "image/png", sizeBytes: 64 })).body.data.media.id;
    expect((await w2.owner.agent.post(`/workspaces/${w2.ws}/media/${pending}/derivatives`).send({ format: "jpeg" })).body.error.code).toBe("MEDIA_NOT_CONVERTIBLE");
    const vid = (await t.db.query<{ id: string }>("INSERT INTO media_assets (workspace_id, kind, storage_key, filename, mime_type, size_bytes, status, created_by) VALUES ($1,'video','k','v.mp4','video/mp4',10,'ready',$2) RETURNING id", [w2.ws, w2.owner.id])).rows[0]!.id;
    expect((await w2.owner.agent.post(`/workspaces/${w2.ws}/media/${vid}/derivatives`).send({ format: "jpeg" })).status).toBe(409);
    const ok = await readyPng(t, w2.owner, w2.ws);
    for (const body of [{ format: "gif" }, { format: "jpeg", maxWidth: 5 }, { format: "jpeg", quality: 5 }, {}]) expect((await w2.owner.agent.post(`/workspaces/${w2.ws}/media/${ok}/derivatives`).send(body)).status).toBe(400);
    const stranger = await t.newUser("s"), viewer = await t.newUser("v");
    await t.db.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'viewer')", [w2.ws, viewer.id]);
    expect((await stranger.agent.post(`/workspaces/${w2.ws}/media/${ok}/derivatives`).send({ format: "jpeg" })).status).toBe(404);
    expect((await viewer.agent.post(`/workspaces/${w2.ws}/media/${ok}/derivatives`).send({ format: "jpeg" })).status).toBe(403);
    const other = await world(t, []);
    expect((await other.owner.agent.post(`/workspaces/${other.ws}/media/${ok}/derivatives`).send({ format: "jpeg" })).status).toBe(404);
  });
});
