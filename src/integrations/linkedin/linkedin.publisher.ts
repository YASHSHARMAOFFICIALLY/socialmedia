import { PlatformError, platformFetch } from "../core/errors.js";
import type { PublishInput, PublishResult } from "../core/types.js";
import { uploadImage, uploadVideo, waitForVideo, type LiCtx } from "./linkedin.media.js";

// Verified (Posts API docs): POST https://api.linkedin.com/rest/posts with Linkedin-Version (YYYYMM) and X-Restli-Protocol-Version: 2.0.0.
// 201 response; the new post URN is in the `x-restli-id` header. Requires w_member_social for member authors.
// The Posts API has no idempotency key, so a failure after the create call is sent is an UNKNOWN outcome (see platformFetch creates:true).
// Finder-based reconciliation needs r_member_social (restricted), so LinkedIn publications cannot be auto-reconciled.

/** commentary is "little text format": these characters must be escaped with a backslash (documented list). */
export const escapeLittleText = (s: string) => s.replace(/[|{}@[\]()<>#\\*_~]/g, "\\$&");
const hashtag = (h: string) => `{hashtag|\\#|${h.replace(/^#/, "")}}`;

export function buildCommentary(text: string, hashtags: string[]): string {
  const tags = hashtags.map(hashtag).join(" ");
  return [escapeLittleText(text.trim()), tags].filter(Boolean).join("\n\n");
}

export function createLinkedInPublisher(opts: { version: string; pollMs?: number }, f: typeof fetch = fetch) {
  return async function publish(i: PublishInput): Promise<PublishResult> {
    const urn = (i.account.metadata.urn as string | undefined) ?? `urn:li:person:${i.account.externalId}`;
    const ctx: LiCtx = {
      f, signal: i.signal, owner: urn, version: opts.version,
      headers: { Authorization: `Bearer ${i.accessToken}`, "Linkedin-Version": opts.version, "X-Restli-Protocol-Version": "2.0.0" },
    };
    const media = i.media.filter((m) => m.role === "media");
    const images = media.filter((m) => m.kind === "image"), videos = media.filter((m) => m.kind === "video");
    if (videos.length > 1 || (videos.length === 1 && images.length > 0)) throw new PlatformError("permanent", "LinkedIn posts carry either one video or images, not both");
    if (images.length > 20) throw new PlatformError("permanent", "LinkedIn allows at most 20 images per post");

    // Uploads first: nothing is visible to anyone until the final create call, so every failure before it is safely retryable.
    let content: Record<string, unknown> | undefined;
    if (images.length === 1) content = { media: { id: await uploadImage(ctx, images[0]!) } };
    else if (images.length > 1) content = { multiImage: { images: await Promise.all(images.map(async (m) => ({ id: await uploadImage(ctx, m) }))) } };
    else if (videos.length === 1) {
      const video = await uploadVideo(ctx, videos[0]!);
      await waitForVideo(ctx, video, opts.pollMs ? { delayMs: opts.pollMs } : {});
      content = { media: { id: video, ...(i.content.title ? { title: i.content.title.slice(0, 400) } : {}) } };
    }

    const res = await platformFetch(f, "linkedin", "https://api.linkedin.com/rest/posts", {
      method: "POST", signal: i.signal,
      headers: { ...ctx.headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        author: urn,
        commentary: buildCommentary(i.content.text, i.content.hashtags),
        visibility: "PUBLIC",
        distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
        ...(content ? { content } : {}),
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      }),
    }, { creates: true });
    const id = res.headers.get("x-restli-id");
    if (!id) throw new PlatformError("unknown", "LinkedIn accepted the post but returned no x-restli-id header"); // it may exist: reconcile/confirm
    return { externalId: id, url: `https://www.linkedin.com/feed/update/${id}/`, raw: { id } };
  };
}
