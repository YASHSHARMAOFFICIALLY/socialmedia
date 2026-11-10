import { describe, it, expect, afterAll } from "vitest";
import { readMp4Meta } from "../src/modules/media/media.mp4.js";
import { createMemoryStorage, createTestApp } from "./helpers/app.js";
import { world } from "./helpers/world.js";

const be32 = (n: number) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const cat = (...p: Uint8Array[]) => { const o = new Uint8Array(p.reduce((s, x) => s + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
const box = (t: string, ...body: Uint8Array[]) => { const b = cat(...body); return cat(be32(8 + b.length), new TextEncoder().encode(t), b); };
const mvhd = (timescale: number, duration: number) => box("mvhd", new Uint8Array(4), new Uint8Array(8), be32(timescale), be32(duration), new Uint8Array(80));
const tkhd = (w: number, h: number) => box("tkhd", new Uint8Array(76), be32(w * 65536), be32(h * 65536));
const trak = (handler: string, w: number, h: number) => box("trak", tkhd(w, h), box("mdia", box("hdlr", new Uint8Array(8), new TextEncoder().encode(handler), new Uint8Array(12))));
const ftyp = box("ftyp", new TextEncoder().encode("isom"), new Uint8Array(8));
const mdat = (n: number) => box("mdat", new Uint8Array(n));
const reader = (file: Uint8Array) => { const reads: number[] = []; return { reads, read: async (a: number, b: number) => { reads.push(b - a + 1); return file.slice(a, b + 1); } }; };

describe("MP4 / QuickTime metadata", () => {
  const moov = box("moov", mvhd(1000, 90_500), trak("soun", 0, 0), trak("vide", 1080, 1920));
  it("reads duration and the video track's pixel size; skips audio tracks", async () => {
    const file = cat(ftyp, mdat(5000), moov);                                   // moov at the END (not faststart)
    const r = reader(file);
    expect(await readMp4Meta(r.read, file.length)).toEqual({ durationMs: 90_500, width: 1080, height: 1920 });
    expect(Math.max(...r.reads)).toBeLessThan(file.length);                     // the media data itself is never downloaded
  });
  it("works for faststart files and different timescales", async () => {
    const file = cat(ftyp, box("moov", mvhd(30000, 900_000), trak("vide", 1280, 720)), mdat(5000));
    expect(await readMp4Meta(reader(file).read, file.length)).toEqual({ durationMs: 30_000, width: 1280, height: 720 });
  });
  it("copes with garbage: truncated boxes, no moov, audio-only, zero timescale", async () => {
    const file = cat(ftyp, mdat(100));
    expect(await readMp4Meta(reader(file).read, file.length)).toBeNull();
    const audio = cat(ftyp, box("moov", mvhd(1000, 5000), trak("soun", 0, 0)));
    expect(await readMp4Meta(reader(audio).read, audio.length)).toEqual({ durationMs: 5000, width: null, height: null });
    const zero = cat(ftyp, box("moov", mvhd(0, 5000)));
    expect((await readMp4Meta(reader(zero).read, zero.length))!.durationMs).toBeNull();
    const cut = cat(ftyp, moov).slice(0, ftyp.length + 20);
    await expect(readMp4Meta(reader(cut).read, cut.length)).resolves.not.toThrow();
    const bomb = cat(ftyp, be32(0x7fffffff), new TextEncoder().encode("moov"), new Uint8Array(32));   // claims a 2 GB moov
    expect(await readMp4Meta(reader(bomb).read, 2 ** 31 + ftyp.length)).toBeNull();                   // refused, not downloaded
  });
});

describe("confirmed videos carry duration and dimensions into platform rules", async () => {
  const mem = createMemoryStorage();
  const t = await createTestApp([], { storage: mem.storage });
  afterAll(t.close);
  it("stores metadata on confirm and uses it for per-platform compatibility", async () => {
    const w = await world(t, []);
    const file = cat(ftyp, mdat(300_000), box("moov", mvhd(1000, 2000), trak("vide", 1920, 1080)));   // 2 s: below LinkedIn's 3 s minimum
    const up = await w.owner.agent.post(`/workspaces/${w.ws}/media/uploads`).send({ filename: "short.mp4", contentType: "video/mp4", sizeBytes: file.length });
    const key = (await t.db.query<{ storage_key: string }>("SELECT storage_key FROM media_assets WHERE id = $1", [up.body.data.media.id])).rows[0]!.storage_key;
    mem.put(key, file, "video/mp4");
    const done = await w.owner.agent.post(`/workspaces/${w.ws}/media/${up.body.data.media.id}/confirm`);
    expect(done.body.data).toMatchObject({ status: "ready", width: 1920, height: 1080, duration_ms: 2000 });
    const c = (await w.owner.agent.get(`/workspaces/${w.ws}/media/${up.body.data.media.id}/compatibility`)).body.data;
    expect(c.linkedin.compatible).toBe(false);
    expect(c.linkedin.issues.map((i: { code: string }) => i.code)).toContain("VIDEO_DURATION");
    expect(c.youtube.compatible).toBe(true);
  });
});
