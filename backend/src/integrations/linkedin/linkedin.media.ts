import { PlatformError, platformFetch } from "../core/errors.js";
import type { ResolvedMedia } from "../core/types.js";

// Verified (LinkedIn Images API / Videos API / Vector Assets docs):
//  - Images: initializeUpload -> uploadUrl; PUT the bytes WITH the OAuth bearer token. Formats JPG/GIF/PNG.
//  - Videos: initializeUpload(fileSizeBytes) -> uploadInstructions[{uploadUrl, firstByte, lastByte}] + uploadToken (4 MB parts);
//    PUT each part WITHOUT an Authorization header; collect each response's ETag; finalizeUpload(uploadToken, uploadedPartIds).
export interface LiCtx { f: typeof fetch; headers: Record<string, string>; version: string; signal: AbortSignal; owner: string }
const BASE = "https://api.linkedin.com/rest";

const json = (c: LiCtx, extra: Record<string, string> = {}) => ({ ...c.headers, "Content-Type": "application/json", ...extra });

export async function uploadImage(c: LiCtx, m: ResolvedMedia): Promise<string> {
  const init = await platformFetch(c.f, "linkedin", `${BASE}/images?action=initializeUpload`, { method: "POST", headers: json(c), signal: c.signal, body: JSON.stringify({ initializeUploadRequest: { owner: c.owner } }) });
  const { value } = (await init.json()) as { value?: { uploadUrl?: string; image?: string } };
  if (!value?.uploadUrl || !value.image) throw new PlatformError("permanent", "linkedin image initializeUpload returned no uploadUrl");
  const src = await platformFetch(c.f, "linkedin-media", await m.url(), { signal: c.signal });
  const bytes = await src.arrayBuffer();
  await platformFetch(c.f, "linkedin", value.uploadUrl, { method: "PUT", headers: { Authorization: c.headers.Authorization!, "Content-Type": m.mimeType }, body: bytes, signal: c.signal });
  return value.image;
}

const PART = 4 * 1024 * 1024;
export async function uploadVideo(c: LiCtx, m: ResolvedMedia): Promise<string> {
  const init = await platformFetch(c.f, "linkedin", `${BASE}/videos?action=initializeUpload`, {
    method: "POST", headers: json(c), signal: c.signal, body: JSON.stringify({ initializeUploadRequest: { owner: c.owner, fileSizeBytes: m.sizeBytes, uploadCaptions: false, uploadThumbnail: false } }),
  });
  const { value } = (await init.json()) as { value?: { video?: string; uploadToken?: string; uploadInstructions?: { uploadUrl: string; firstByte: number; lastByte: number }[] } };
  if (!value?.video || !value.uploadInstructions?.length) throw new PlatformError("permanent", "linkedin video initializeUpload returned no upload instructions");
  const source = await m.url();
  const etags: string[] = [];
  for (const part of value.uploadInstructions) {
    // Stream one part at a time (<= 4 MB in memory) from object storage using a Range request.
    const src = await platformFetch(c.f, "linkedin-media", source, { headers: { Range: `bytes=${part.firstByte}-${part.lastByte}` }, signal: c.signal });
    if (src.status !== 206) throw new PlatformError("permanent", "Media storage did not honour the Range request");
    const put = await platformFetch(c.f, "linkedin", part.uploadUrl, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: await src.arrayBuffer(), signal: c.signal });
    const etag = put.headers.get("etag");
    if (!etag) throw new PlatformError("permanent", "linkedin video part upload returned no ETag");
    etags.push(etag.replace(/"/g, ""));
  }
  await platformFetch(c.f, "linkedin", `${BASE}/videos?action=finalizeUpload`, { method: "POST", headers: json(c), signal: c.signal, body: JSON.stringify({ finalizeUploadRequest: { video: value.video, uploadToken: value.uploadToken ?? "", uploadedPartIds: etags } }) });
  return value.video;
}

/** Waits until LinkedIn finished processing the video (status AVAILABLE). Nothing public exists yet, so failures here are safe to retry. */
export async function waitForVideo(c: LiCtx, urn: string, opts: { tries?: number; delayMs?: number } = {}) {
  const tries = opts.tries ?? 20, delayMs = opts.delayMs ?? 3000;
  for (let i = 0; i < tries; i++) {
    const res = await platformFetch(c.f, "linkedin", `${BASE}/videos/${encodeURIComponent(urn)}`, { headers: c.headers, signal: c.signal });
    const v = (await res.json()) as { status?: string; processingFailureReason?: string };
    if (v.status === "AVAILABLE") return;
    if (v.status === "PROCESSING_FAILED") throw new PlatformError("permanent", `linkedin video processing failed: ${v.processingFailureReason ?? "unknown reason"}`);
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new PlatformError("retryable", "linkedin video is still processing");
}
