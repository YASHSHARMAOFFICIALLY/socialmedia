import { matchRecentPost } from "../core/reconcile.js";
import { PlatformError, classifyHttp, retryAfterSeconds } from "../core/errors.js";
import type { PublishInput, PublishResult, SocialAdapter } from "../core/types.js";

// Verified (YouTube Data API videos.insert + resumable upload protocol docs):
//  1. POST upload/youtube/v3/videos?uploadType=resumable&part=snippet,status  (X-Upload-Content-Length/Type) -> 200 + Location (session URI)
//  2. PUT the file to the session URI. If the connection breaks, an empty PUT with `Content-Range: bytes */<total>` returns 308 (+ Range of
//     received bytes) or 200/201 if the upload actually completed; resume from the next byte.
// Quota: videos.insert has its own default bucket of 100 calls/day (docs "Quota Calculator").
const INIT = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";

const QUOTA_REASONS = new Set(["quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded", "userRateLimitExceeded", "uploadLimitExceeded"]);
const AUTH_REASONS = new Set(["authError", "authorizationRequired", "unauthorized"]);

/** Seconds until midnight Pacific Time (when YouTube quotas reset), capped. */
function secondsUntilQuotaReset(now = new Date()): number {
  const pt = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const next = new Date(pt); next.setHours(24, 0, 5, 0);
  return Math.min(Math.max(60, Math.round((next.getTime() - pt.getTime()) / 1000)), 24 * 3600);
}

export async function toYouTubeError(res: Response, creating: boolean): Promise<PlatformError> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string; errors?: { reason?: string }[] } } | null;
  const reason = body?.error?.errors?.[0]?.reason ?? "";
  const msg = `youtube responded ${res.status}${reason ? ` (${reason})` : ""}: ${body?.error?.message ?? ""}`.trim();
  const opts = { status: res.status, code: reason };
  if (QUOTA_REASONS.has(reason)) return new PlatformError("rate_limited", msg, { ...opts, retryAfterS: retryAfterSeconds(res.headers.get("retry-after")) ?? secondsUntilQuotaReset() });
  if (AUTH_REASONS.has(reason) || res.status === 401) return new PlatformError("auth_expired", msg, opts);
  if (creating && res.status >= 500) return new PlatformError("unknown", msg, opts);
  return new PlatformError(classifyHttp(res.status), msg, opts);
}

const fixedLength = (body: ReadableStream<Uint8Array>, size: number): ReadableStream<Uint8Array> => {
  const FLS = (globalThis as { FixedLengthStream?: new (n: number) => TransformStream<Uint8Array, Uint8Array> }).FixedLengthStream;
  if (!FLS) return body; // Node (tests): no length constraint needed
  const { readable, writable } = new FLS(size);
  void body.pipeTo(writable);
  return readable;
};

export function createYouTubePublisher(f: typeof fetch = fetch, o: { maxResumes?: number } = {}): NonNullable<SocialAdapter["publish"]> {
  return async function publish(i: PublishInput): Promise<PublishResult> {
    const video = i.media.find((m) => m.role === "media" && m.kind === "video");
    if (!video) throw new PlatformError("permanent", "YouTube requires a video");
    const meta = i.content.metadata as { privacyStatus?: string; categoryId?: string; madeForKids?: boolean; publishAt?: string };
    const thumb = i.media.find((m) => m.role === "thumbnail");
    const auth = { Authorization: `Bearer ${i.accessToken}` };

    // Step 1: register the upload. Nothing exists on YouTube yet, so failures here are plain retryable/permanent errors.
    const initRes = await f(INIT, {
      method: "POST", signal: i.signal,
      headers: { ...auth, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Length": String(video.sizeBytes), "X-Upload-Content-Type": video.mimeType },
      body: JSON.stringify({
        snippet: { title: i.content.title, description: i.content.description ?? i.content.text, tags: i.content.hashtags, ...(meta.categoryId ? { categoryId: meta.categoryId } : {}) },
        status: { privacyStatus: meta.publishAt ? "private" : meta.privacyStatus ?? "public", ...(meta.publishAt ? { publishAt: new Date(meta.publishAt).toISOString() } : {}), ...(typeof meta.madeForKids === "boolean" ? { selfDeclaredMadeForKids: meta.madeForKids } : {}) },
      }),
    }).catch((e) => { throw new PlatformError("retryable", `youtube init failed: ${(e as Error).message}`); });
    if (!initRes.ok) throw await toYouTubeError(initRes, false);
    const session = initRes.headers.get("location");
    if (!session) throw new PlatformError("permanent", "youtube did not return a resumable session URI");

    // Step 2: stream the file. A broken connection is resolved by asking YouTube how much it received (never by starting over).
    const source = await video.url();
    let offset = 0;
    for (let attempt = 0; attempt <= (o.maxResumes ?? 3); attempt++) {
      try {
        const src = await f(source, { signal: i.signal, ...(offset > 0 ? { headers: { Range: `bytes=${offset}-` } } : {}) });
        if (!src.ok || !src.body) throw new PlatformError("retryable", `media source responded ${src.status}`);
        const remaining = video.sizeBytes - offset;
        const res = await f(session, {
          method: "PUT", signal: i.signal, duplex: "half",
          headers: { "Content-Type": video.mimeType, "Content-Length": String(remaining), ...(offset > 0 ? { "Content-Range": `bytes ${offset}-${video.sizeBytes - 1}/${video.sizeBytes}` } : {}) },
          body: fixedLength(src.body, remaining),
        } as RequestInit);
        return await withThumbnail(await finish(res), thumb, i.accessToken, i.signal);
      } catch (e) {
        if (e instanceof PlatformError && e.kind !== "unknown" && !(e.kind === "retryable" && attempt < (o.maxResumes ?? 3))) throw e;
        // ambiguous: ask the session what it has
        const st = await f(session, { method: "PUT", signal: i.signal, headers: { "Content-Range": `bytes */${video.sizeBytes}`, "Content-Length": "0" } }).catch(() => null);
        if (!st) throw new PlatformError("unknown", "youtube upload interrupted and its status could not be checked");
        if (st.status === 200 || st.status === 201) return withThumbnail(await finish(st), thumb, i.accessToken, i.signal);
        if (st.status === 308) { const m = /bytes=0-(\d+)/.exec(st.headers.get("range") ?? ""); offset = m ? Number(m[1]) + 1 : 0; continue; }
        throw new PlatformError("unknown", `youtube upload status check returned ${st.status}`); // session expired etc.: outcome unclear
      }
    }
    throw new PlatformError("unknown", "youtube upload kept getting interrupted");
  };

  /** The video is already public when we get here: a thumbnail problem must never fail (or retry) the publication, only be reported. */
  async function withThumbnail(result: PublishResult, thumb?: PublishInput["media"][number], accessToken?: string, signal?: AbortSignal | null): Promise<PublishResult> {
    if (!thumb || !accessToken) return result;
    try {
      const img = await f(await thumb.url(), { signal: signal ?? null });
      if (!img.ok) throw new Error(`thumbnail source responded ${img.status}`);
      const res = await f(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(result.externalId)}`, { method: "POST", signal: signal ?? null, headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": thumb.mimeType }, body: await img.arrayBuffer() });
      if (!res.ok) { const e = await toYouTubeError(res, false); throw new Error(e.message); }
      return result;
    } catch (e) { return { ...result, warnings: [`Video published, but the custom thumbnail was not set: ${(e as Error).message}`] }; }
  }

  async function finish(res: Response): Promise<PublishResult> {
    if (!res.ok) throw await toYouTubeError(res, true);
    const v = (await res.json().catch(() => null)) as { id?: string } | null;
    if (!v?.id) throw new PlatformError("unknown", "youtube accepted the upload but returned no video id");
    return { externalId: v.id, url: `https://www.youtube.com/watch?v=${v.id}`, raw: { id: v.id } };
  }
}

/** Looks at the channel's uploads playlist (cheap list call) for a video we just tried to upload. */
export function createYouTubeReconciler(f: typeof fetch = fetch): NonNullable<SocialAdapter["reconcile"]> {
  return async ({ accessToken, account, content, since, exclude = [] }) => {
    const playlist = account.metadata.uploadsPlaylistId as string | null | undefined;
    if (!playlist || !content.title) return null;
    const res = await f(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=10&playlistId=${encodeURIComponent(playlist)}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw await toYouTubeError(res, false);
    const items = ((await res.json()) as { items?: { snippet?: { title?: string; publishedAt?: string; resourceId?: { videoId?: string } } }[] }).items ?? [];
    const posts = items.map((it) => ({ id: it.snippet?.resourceId?.videoId ?? "", text: it.snippet?.title ?? "", at: it.snippet?.publishedAt }));
    const id = matchRecentPost(posts.filter((p) => p.id), content.title, since, exclude)?.id;
    return id ? { externalId: id, url: `https://www.youtube.com/watch?v=${id}` } : null;
  };
}
