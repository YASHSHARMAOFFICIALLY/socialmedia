// Content sniffing from the first bytes: the declared MIME type is never trusted.
const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.slice(at, at + n));

export function sniffMime(b: Uint8Array): string | null {
  if (startsWith(b, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a") return "image/gif";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "image/webp";
  if (ascii(b, 4, 4) === "ftyp") return ascii(b, 8, 4) === "qt  " ? "video/quicktime" : "video/mp4";
  if (startsWith(b, [0x1a, 0x45, 0xdf, 0xa3])) return "video/webm";
  return null;
}

const u16 = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const u32 = (b: Uint8Array, i: number) => ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;

export function imageDimensions(b: Uint8Array, mime: string): { width: number; height: number } | null {
  if (mime === "image/png" && b.length >= 24) return { width: u32(b, 16), height: u32(b, 20) };
  if (mime === "image/gif" && b.length >= 10) return { width: b[6]! | (b[7]! << 8), height: b[8]! | (b[9]! << 8) };
  if (mime === "image/jpeg") {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1]!;
      if (marker === 0xff) { i++; continue; }
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { height: u16(b, i + 5), width: u16(b, i + 7) };
      i += 2 + u16(b, i + 2);
    }
  }
  return null; // webp / video dimensions are not extracted
}
