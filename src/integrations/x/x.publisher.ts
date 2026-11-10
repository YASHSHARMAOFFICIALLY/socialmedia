import { PlatformError, platformFetch } from "../core/errors.js";
import type { PublishInput, PublishResult, ResolvedMedia, SocialAdapter } from "../core/types.js";
import { withHashtags } from "../core/rules.js";

// Verified (docs.x.com): chunked media upload = POST /2/media/upload/initialize (JSON: media_type, total_bytes, media_category) ->
// data.id; POST /2/media/upload/{id}/append (multipart: segment_index, media; <=5 MB per segment, server max 8 MB);
// POST /2/media/upload/{id}/finalize -> optional processing_info {state, check_after_secs}; GET /2/media/upload?command=STATUS&media_id=.
// Categories: tweet_image (5 MB), tweet_gif (15 MB), tweet_video (20 min / 8 GB). A post holds up to 4 photos, 1 GIF or 1 video.
// Create: POST /2/tweets {text, media:{media_ids}} -> 201 {data:{id}}. Scope media.write for uploads, tweet.write for posting.
const API = "https://api.x.com/2";
const SEGMENT = 4 * 1024 * 1024;

const category = (m: ResolvedMedia) => (m.kind === "video" ? "tweet_video" : m.mimeType === "image/gif" ? "tweet_gif" : "tweet_image");

async function uploadMedia(f: typeof fetch, i: PublishInput, m: ResolvedMedia, pollMs: number): Promise<string> {
  const auth = { Authorization: `Bearer ${i.accessToken}` };
  const init = await platformFetch(f, "x", `${API}/media/upload/initialize`, { method: "POST", signal: i.signal, headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ media_type: m.mimeType, total_bytes: m.sizeBytes, media_category: category(m) }) });
  const id = ((await init.json()) as { data?: { id?: string } }).data?.id;
  if (!id) throw new PlatformError("permanent", "x media initialize returned no id");
  const source = await m.url();
  for (let seg = 0, start = 0; start < m.sizeBytes; seg++, start += SEGMENT) {
    const end = Math.min(start + SEGMENT, m.sizeBytes) - 1;
    const src = await platformFetch(f, "x-media", source, { headers: { Range: `bytes=${start}-${end}` }, signal: i.signal });
    if (src.status !== 206 && m.sizeBytes > SEGMENT) throw new PlatformError("permanent", "Media storage did not honour the Range request");
    const form = new FormData();
    form.set("segment_index", String(seg));
    form.set("media", new Blob([await src.arrayBuffer()], { type: m.mimeType }), "chunk");
    await platformFetch(f, "x", `${API}/media/upload/${id}/append`, { method: "POST", headers: auth, body: form, signal: i.signal });
  }
  const fin = await platformFetch(f, "x", `${API}/media/upload/${id}/finalize`, { method: "POST", headers: auth, signal: i.signal });
  let info = ((await fin.json().catch(() => null)) as { data?: { processing_info?: { state: string; check_after_secs?: number; error?: { message?: string } } } } | null)?.data?.processing_info;
  for (let tries = 0; info && info.state !== "succeeded" && tries < 40; tries++) {
    if (info.state === "failed") throw new PlatformError("permanent", `x media processing failed: ${info.error?.message ?? "unknown"}`);
    await new Promise((r) => setTimeout(r, pollMs || (info!.check_after_secs ?? 2) * 1000));
    const st = await platformFetch(f, "x", `${API}/media/upload?command=STATUS&media_id=${id}`, { headers: auth, signal: i.signal });
    info = ((await st.json()) as { data?: { processing_info?: typeof info } }).data?.processing_info;
  }
  if (info && info.state !== "succeeded") throw new PlatformError("retryable", "x media is still processing");
  return id;
}

export function createXPublisher(f: typeof fetch = fetch, o: { pollMs?: number } = {}): NonNullable<SocialAdapter["publish"]> {
  return async (i) => {
    const media = i.media.filter((m) => m.role === "media");
    // Uploads create nothing public: failures here are safe to retry.
    const ids: string[] = [];
    for (const m of media) ids.push(await uploadMedia(f, i, m, o.pollMs ?? 0));
    const res = await platformFetch(f, "x", `${API}/tweets`, {
      method: "POST", signal: i.signal,
      headers: { Authorization: `Bearer ${i.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: withHashtags(i.content), ...(ids.length ? { media: { media_ids: ids } } : {}) }),
    }, { creates: true });
    const id = ((await res.json().catch(() => null)) as { data?: { id?: string } } | null)?.data?.id;
    if (!id) throw new PlatformError("unknown", "x accepted the post but returned no id");
    const handle = i.account.metadata.username as string | undefined;
    return { externalId: id, url: `https://x.com/${handle ?? "i/web"}/status/${id}`, raw: { id } } satisfies PublishResult;
  };
}

/** Best effort: needs read access on the app's X API tier; on failure the engine falls back to 'unconfirmed'. */
export function createXReconciler(f: typeof fetch = fetch): NonNullable<SocialAdapter["reconcile"]> {
  return async ({ accessToken, account, content, since }) => {
    const res = await platformFetch(f, "x", `${API}/users/${account.externalId}/tweets?max_results=10&tweet.fields=created_at`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const tweets = ((await res.json()) as { data?: { id: string; text: string; created_at?: string }[] }).data ?? [];
    const want = withHashtags(content).trim();
    const hit = tweets.find((t) => t.text.trim() === want && (!t.created_at || new Date(t.created_at) >= since));
    return hit ? { externalId: hit.id } : null;
  };
}
