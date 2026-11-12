// MP4 / QuickTime metadata (ISO BMFF): duration from `mvhd`, pixel size from the first video `tkhd`. Reads boxes with ranged requests, so a
// multi-GB file costs a handful of small reads (the `moov` box is at the start for "faststart" files and at the end otherwise).
export interface VideoMeta { durationMs: number | null; width: number | null; height: number | null }
type Read = (start: number, endInclusive: number) => Promise<Uint8Array>;

const u32 = (b: Uint8Array, o: number) => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
const u64 = (b: Uint8Array, o: number) => u32(b, o) * 2 ** 32 + u32(b, o + 4);
const type = (b: Uint8Array, o: number) => String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);
const MAX_MOOV = 16 * 1024 * 1024;

/** Child boxes of a buffer region. */
function* boxes(b: Uint8Array, start = 0, end = b.length): Generator<{ type: string; body: [number, number] }> {
  let o = start;
  while (o + 8 <= end) {
    let size = u32(b, o); const t = type(b, o + 4); let header = 8;
    if (size === 1) { size = u64(b, o + 8); header = 16; } else if (size === 0) size = end - o;
    if (size < header || o + size > end) return;          // truncated/corrupt: stop quietly
    yield { type: t, body: [o + header, o + size] };
    o += size;
  }
}

function parseMoov(b: Uint8Array): VideoMeta {
  const meta: VideoMeta = { durationMs: null, width: null, height: null };
  const [s, e] = [0, b.length];
  for (const box of boxes(b, s, e)) {
    if (box.type === "mvhd") {
      const [o] = box.body, v = b[o]!;
      const timescale = v === 1 ? u32(b, o + 20) : u32(b, o + 12), duration = v === 1 ? u64(b, o + 24) : u32(b, o + 16);
      if (timescale > 0) meta.durationMs = Math.round((duration / timescale) * 1000);
    } else if (box.type === "trak" && meta.width === null) {
      let isVideo = false, w = 0, h = 0;
      for (const c of boxes(b, ...box.body)) {
        if (c.type === "tkhd") { const [o] = c.body, v = b[o]!, base = o + (v === 1 ? 88 : 76); w = u32(b, base) / 65536; h = u32(b, base + 4) / 65536; }
        if (c.type === "mdia") for (const m of boxes(b, ...c.body)) if (m.type === "hdlr") isVideo = type(b, m.body[0] + 8) === "vide";
      }
      if (isVideo && w > 0 && h > 0) { meta.width = Math.round(w); meta.height = Math.round(h); }
    }
  }
  return meta;
}

export async function readMp4Meta(read: Read, size: number): Promise<VideoMeta | null> {
  let o = 0;
  for (let i = 0; i < 64 && o + 8 <= size; i++) {                    // top-level boxes only, at most 64 hops
    const head = await read(o, Math.min(o + 15, size - 1));
    let boxSize = u32(head, 0); const t = type(head, 4); let header = 8;
    if (boxSize === 1) { boxSize = u64(head, 8); header = 16; } else if (boxSize === 0) boxSize = size - o;
    if (boxSize < header) return null;
    if (t === "moov") {
      if (boxSize - header > MAX_MOOV) return null;
      return parseMoov(await read(o + header, o + boxSize - 1));
    }
    o += boxSize;
  }
  return null;
}
