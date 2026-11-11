import { describe, it, expect, afterAll } from "vitest";
import type { VideoTransformer, VideoTransformOptions } from "../src/infrastructure/storage/video-transform.js";
import { cloudflareVideoTransformer } from "../src/infrastructure/storage/video-transform.js";
import { createMemoryStorage, createTestApp } from "./helpers/app.js";
import { world } from "./helpers/world.js";

const be32 = (n: number) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const cat = (...p: Uint8Array[]) => { const o = new Uint8Array(p.reduce((s, x) => s + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
const box = (t: string, ...body: Uint8Array[]) => { const b = cat(...body); return cat(be32(8 + b.length), new TextEncoder().encode(t), b); };
const mvhd = (timescale: number, duration: number) => box("mvhd", new Uint8Array(4), new Uint8Array(8), be32(timescale), be32(duration), new Uint8Array(80));
const tkhd = (w: number, h: number) => box("tkhd", new Uint8Array(76), be32(w * 65536), be32(h * 65536));
const trak = (w: number, h: number) => box("trak", tkhd(w, h), box("mdia", box("hdlr", new Uint8Array(8), new TextEncoder().encode("vide"), new Uint8Array(12))));
const ftyp = box("ftyp", new TextEncoder().encode("isom"), new Uint8Array(8));
/** A minimal valid MP4 of the given length and size. */
const mp4 = (seconds: number, w: number, h: number) => cat(ftyp, box("mdat", new Uint8Array(500)), box("moov", mvhd(1000, seconds * 1000), trak(w, h)));
const png = () => { const b = new Uint8Array(64); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); return b; };

describe("video derivatives (Cloudflare Media Transformations port)", async () => {
  const mem = createMemoryStorage();
  let reply: "ok" | "wrong-type" | "fail" = "ok";
  const calls: { url: string; o: VideoTransformOptions }[] = [];
  const videos: VideoTransformer = { transform: async (url, o) => {
    calls.push({ url, o });
    if (reply === "fail") throw new Error("boom with secret-token");
    return { bytes: reply === "wrong-type" ? png() : mp4(o.durationS ?? 10, o.width ?? 720, Math.round((o.width ?? 720) * 16 / 9)), contentType: "video/mp4" };
  } };
  const t = await createTestApp([], { storage: mem.storage, videos });
  const none = await createTestApp([], { storage: mem.storage, videos: null });
  afterAll(async () => { await t.close(); await none.close(); });

  const readyVideo = async (app: typeof t, u: Awaited<ReturnType<typeof t.newUser>>, ws: string, file: Uint8Array) => {
    const up = await u.agent.post(`/workspaces/${ws}/media/uploads`).send({ filename: "clip.mp4", contentType: "video/mp4", sizeBytes: file.length });
    const key = (await app.db.query<{ storage_key: string }>("SELECT storage_key FROM media_assets WHERE id = $1", [up.body.data.media.id])).rows[0]!.storage_key;
    mem.put(key, file, "video/mp4");
    expect((await u.agent.post(`/workspaces/${ws}/media/${up.body.data.media.id}/confirm`)).status).toBe(200);
    return up.body.data.media.id as string;
  };

  it("downscales a short video into a verified, linked asset (duration and size read back from the file)", async () => {
    const w = await world(t, []);
    const id = await readyVideo(t, w.owner, w.ws, mp4(20, 1920, 1080));
    const r = await w.owner.agent.post(`/workspaces/${w.ws}/media/${id}/video-derivatives`).send({ maxWidth: 720 });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ kind: "video", mime_type: "video/mp4", status: "ready", width: 720, height: 1280, duration_ms: 20_000, filename: "clip.mp4" });
    expect(calls.at(-1)!.o).toMatchObject({ width: 720, durationS: 20, audio: true, fit: "scale-down" });
    expect(calls.at(-1)!.url).toContain("expires=900");
    const row = (await t.db.query<{ derived_from: string; storage_key: string }>("SELECT derived_from, storage_key FROM media_assets WHERE id = $1", [r.body.data.id])).rows[0]!;
    expect(row.derived_from).toBe(id);
    expect(mem.objects.get(row.storage_key)!.contentType).toBe("video/mp4");
  });

  it("a video longer than the service's 60 s output needs an explicit cut; it is never silently truncated", async () => {
    const w = await world(t, []);
    const id = await readyVideo(t, w.owner, w.ws, mp4(90, 1920, 1080));
    const refused = await w.owner.agent.post(`/workspaces/${w.ws}/media/${id}/video-derivatives`).send({ maxWidth: 720 });
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe("VIDEO_CUT_REQUIRED");
    const cut = await w.owner.agent.post(`/workspaces/${w.ws}/media/${id}/video-derivatives`).send({ maxWidth: 720, startSeconds: 5, maxSeconds: 30 });
    expect(cut.status).toBe(201);
    expect(calls.at(-1)!.o).toMatchObject({ startS: 5, durationS: 30 });
    expect(cut.body.data.duration_ms).toBe(30_000);
  });

  it("validates input and output, hides provider details, and is unavailable without the zone", async () => {
    const w = await world(t, []);
    const id = await readyVideo(t, w.owner, w.ws, mp4(10, 1280, 720));
    expect((await w.owner.agent.post(`/workspaces/${w.ws}/media/${id}/video-derivatives`).send({})).status).toBe(400);            // needs a target size
    expect((await w.owner.agent.post(`/workspaces/${w.ws}/media/${id}/video-derivatives`).send({ maxWidth: 5000 })).status).toBe(400);
    reply = "wrong-type";
    expect((await w.owner.agent.post(`/workspaces/${w.ws}/media/${id}/video-derivatives`).send({ maxWidth: 720 })).body.error.code).toBe("VIDEO_TRANSFORM_FAILED");
    reply = "fail";
    const failed = await w.owner.agent.post(`/workspaces/${w.ws}/media/${id}/video-derivatives`).send({ maxWidth: 720 });
    expect(failed.status).toBe(502);
    expect(JSON.stringify(failed.body)).not.toContain("secret-token");
    reply = "ok";
    const img = await w.owner.agent.post(`/workspaces/${w.ws}/media/uploads`).send({ filename: "a.png", contentType: "image/png", sizeBytes: 64 });
    expect((await w.owner.agent.post(`/workspaces/${w.ws}/media/${img.body.data.media.id}/video-derivatives`).send({ maxWidth: 720 })).status).toBe(409);   // not a confirmed video
    const w2 = await world(none, []);
    const id2 = await readyVideo(none, w2.owner, w2.ws, mp4(10, 1280, 720));
    expect((await w2.owner.agent.post(`/workspaces/${w2.ws}/media/${id2}/video-derivatives`).send({ maxWidth: 720 })).body.error.code).toBe("VIDEO_TRANSFORM_UNAVAILABLE");
    const viewer = await t.newUser("vw");
    await t.db.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'viewer')", [w.ws, viewer.id]);
    expect((await viewer.agent.post(`/workspaces/${w.ws}/media/${id}/video-derivatives`).send({ maxWidth: 720 })).status).toBe(403);
  });

  it("the Cloudflare adapter builds /cdn-cgi/media/<options>/<source> and rejects non-video answers", async () => {
    let url = "";
    const f = (async (u: string) => { url = u; return new Response(new Uint8Array([1]), { headers: { "content-type": "video/mp4" } }); }) as unknown as typeof fetch;
    await cloudflareVideoTransformer("https://zone.example/", f).transform("https://r2.example/obj?sig=1", { width: 720, fit: "contain", durationS: 30, startS: 5, audio: false });
    expect(url).toBe("https://zone.example/cdn-cgi/media/mode=video,fit=contain,audio=false,width=720,time=5s,duration=30s/https://r2.example/obj?sig=1");
    const html = (async () => new Response("<html>", { headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
    await expect(cloudflareVideoTransformer("https://zone.example", html).transform("https://r2/o", { fit: "contain", audio: true })).rejects.toThrow(/did not return a video/);
  });
});
