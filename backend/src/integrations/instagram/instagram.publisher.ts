import { PlatformError, platformFetch } from "../core/errors.js";
import { withHashtags } from "../core/rules.js";
import type { PublishInput, PublishResult, SocialAdapter } from "../core/types.js";
import { GRAPH } from "./instagram.auth.js";

// Verified (Instagram Platform "Content Publishing" docs):
//  - Media is fetched BY META from a public URL (image_url / video_url), so it must be reachable when the container is created.
//  - POST /<IG_ID>/media (image_url|video_url, caption, media_type) -> { id: container }; JPEG is the only supported image format.
//  - Reels: media_type=REELS + video_url. Carousel: child containers (is_carousel_item=true; videos as media_type=VIDEO) then media_type=CAROUSEL + children (max 20).
//  - GET /<container>?fields=status_code -> FINISHED | IN_PROGRESS | ERROR | EXPIRED
//  - POST /<IG_ID>/media_publish {creation_id} -> { id: media id }. Rate limit enforced here (100 per 24h per docs; check /content_publishing_limit).
const bearer = (t: string) => ({ Authorization: `Bearer ${t}`, "Content-Type": "application/json" });

export function createInstagramPublisher(f: typeof fetch = fetch, o: { pollMs?: number; maxPolls?: number } = {}): NonNullable<SocialAdapter["publish"]> {
  return async function publish(i: PublishInput): Promise<PublishResult> {
    const ig = i.account.externalId;
    const media = i.media.filter((m) => m.role === "media");
    if (media.length === 0) throw new PlatformError("permanent", "Instagram posts require media");
    const caption = withHashtags(i.content);
    const post = async (path: string, body: object, creates = false) => {
      const res = await platformFetch(f, "instagram", `${GRAPH}/${path}`, { method: "POST", headers: bearer(i.accessToken), body: JSON.stringify(body), signal: i.signal }, { creates });
      return (await res.json()) as { id?: string };
    };
    const container = async (m: (typeof media)[number], extra: object) => {
      const url = await m.url();
      // A carousel child video is media_type VIDEO; a standalone video is a REEL.
      const carouselChild = (extra as { is_carousel_item?: boolean }).is_carousel_item === true;
      const body = m.kind === "image" ? { image_url: url, ...extra } : { video_url: url, media_type: carouselChild ? "VIDEO" : "REELS", ...extra };
      const id = (await post(`${ig}/media`, body)).id;
      if (!id) throw new PlatformError("permanent", "instagram returned no container id");
      return id;
    };
    const waitFinished = async (id: string) => {
      for (let n = 0; n < (o.maxPolls ?? 30); n++) {
        const res = await platformFetch(f, "instagram", `${GRAPH}/${id}?fields=status_code`, { headers: bearer(i.accessToken), signal: i.signal });
        const s = ((await res.json()) as { status_code?: string }).status_code;
        if (s === "FINISHED") return;
        if (s === "ERROR" || s === "EXPIRED") throw new PlatformError("permanent", `instagram container ${s}`);
        await new Promise((r) => setTimeout(r, o.pollMs ?? 3000));
      }
      throw new PlatformError("retryable", "instagram is still processing the media");
    };

    // Containers are invisible until media_publish, so everything before it is safely retryable.
    let creationId: string;
    if (media.length === 1) {
      creationId = await container(media[0]!, { caption });
    } else {
      const children: string[] = [];
      for (const m of media) { const id = await container(m, { is_carousel_item: true }); await waitFinished(id); children.push(id); }
      const id = (await post(`${ig}/media`, { media_type: "CAROUSEL", children: children.join(","), caption })).id;
      if (!id) throw new PlatformError("permanent", "instagram returned no carousel container id");
      creationId = id;
    }
    await waitFinished(creationId);

    const published = await post(`${ig}/media_publish`, { creation_id: creationId }, true);
    if (!published.id) throw new PlatformError("unknown", "instagram accepted the publish but returned no media id");
    let url: string | undefined;
    try { // permalink is a nicety: never fail a successful publish over it
      const r = await f(`${GRAPH}/${published.id}?fields=permalink`, { headers: bearer(i.accessToken), signal: i.signal });
      url = r.ok ? ((await r.json()) as { permalink?: string }).permalink : undefined;
    } catch { /* ignore */ }
    return { externalId: published.id, ...(url ? { url } : {}), raw: { id: published.id } };
  };
}

/** Lists the account's most recent media (IG User media edge) and matches on caption + time. */
export function createInstagramReconciler(f: typeof fetch = fetch): NonNullable<SocialAdapter["reconcile"]> {
  return async ({ accessToken, account, content, since }) => {
    const res = await platformFetch(f, "instagram", `${GRAPH}/${account.externalId}/media?fields=id,caption,timestamp,permalink&limit=10`, { headers: bearer(accessToken) });
    const items = ((await res.json()) as { data?: { id: string; caption?: string; timestamp?: string; permalink?: string }[] }).data ?? [];
    const want = withHashtags(content).trim();
    const hit = items.find((m) => (m.caption ?? "").trim() === want && (!m.timestamp || new Date(m.timestamp) >= since));
    return hit ? { externalId: hit.id, ...(hit.permalink ? { url: hit.permalink } : {}) } : null;
  };
}
