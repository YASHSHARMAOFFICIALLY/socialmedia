import { chars, mediaOnly, withHashtags, type ContentRules, type Issue } from "../core/rules.js";

// Official (docs.x.com): up to 4 photos, 1 animated GIF or 1 video per post; media categories tweet_image 5 MB, tweet_gif 15 MB,
// tweet_video 20 min / 8 GB (Premium: 125 min / 16 GB). 280 chars applies to standard accounts.
// UNVERIFIED: longer limits for Premium accounts (third-party reports 25,000) => only allowed via metadata.longPost with a warning.
const URL_RE = /https?:\/\/\S+/g;
const weighted = (s: string) => chars(s.replace(URL_RE, "x".repeat(23))); // t.co wrapping: every URL counts as 23 (approximate)

export const xRules: ContentRules = {
  platform: "x",
  validate(c) {
    const issues: Issue[] = [];
    const text = withHashtags(c);
    const n = weighted(text);
    const long = c.metadata.longPost === true;
    if (!text && mediaOnly(c).length === 0) issues.push({ code: "EMPTY", field: "caption", severity: "error", message: "Post needs text or media" });
    if (!long && n > 280) issues.push({ code: "TEXT_TOO_LONG", field: "caption", severity: "error", message: `Text is ${n} characters (approximate); standard accounts allow 280. Set metadata.longPost=true only for Premium accounts` });
    if (long && n > 25000) issues.push({ code: "TEXT_TOO_LONG", field: "caption", severity: "warning", message: `Text is ${n} characters; the Premium limit (25,000) is not confirmed by official docs` });
    // Thread: metadata.thread = further tweets, each a reply to the previous one. Text only (media belongs to the first tweet).
    if (c.metadata.thread !== undefined) {
      const t = c.metadata.thread;
      if (!Array.isArray(t) || t.length === 0 || t.length > 24 || t.some((x) => typeof x !== "string" || !x.trim())) issues.push({ code: "THREAD_INVALID", field: "metadata", severity: "error", message: "metadata.thread must be 1 to 24 non-empty strings" });
      else t.forEach((x, i) => { if (!long && weighted(x as string) > 280) issues.push({ code: "TEXT_TOO_LONG", field: "metadata", severity: "error", message: `Thread tweet ${i + 2} is ${weighted(x as string)} characters (approximate); the limit is 280` }); });
    }
    // Poll: metadata.poll = { options: 2-4 strings (<=25 chars), durationMinutes: 5..10080 }. Cannot be combined with media.
    if (c.metadata.poll !== undefined) {
      const p = c.metadata.poll as { options?: unknown; durationMinutes?: unknown } | null;
      const opts = p && Array.isArray(p.options) ? p.options : null;
      if (!opts || opts.length < 2 || opts.length > 4 || opts.some((o) => typeof o !== "string" || !o.trim() || chars(o) > 25)) issues.push({ code: "POLL_INVALID", field: "metadata", severity: "error", message: "metadata.poll.options must be 2 to 4 choices of at most 25 characters" });
      if (!p || !Number.isInteger(p.durationMinutes) || (p.durationMinutes as number) < 5 || (p.durationMinutes as number) > 10080) issues.push({ code: "POLL_DURATION", field: "metadata", severity: "error", message: "metadata.poll.durationMinutes must be a whole number from 5 to 10080" });
      if (mediaOnly(c).length > 0) issues.push({ code: "POLL_WITH_MEDIA", field: "media", severity: "error", message: "A poll cannot be combined with media" });
    }
    const media = mediaOnly(c);
    const videos = media.filter((m) => m.kind === "video"), images = media.filter((m) => m.kind === "image");
    const gifs = images.filter((m) => m.mimeType === "image/gif");
    if (videos.length > 1) issues.push({ code: "TOO_MANY_VIDEOS", field: "media", severity: "error", message: "X allows one video per post" });
    if (videos.length === 1 && images.length > 0) issues.push({ code: "MIXED_MEDIA", field: "media", severity: "error", message: "X allows up to 4 photos, 1 GIF or 1 video; they cannot be combined" });
    if (gifs.length > 0 && media.length > 1) issues.push({ code: "GIF_NOT_ALONE", field: "media", severity: "error", message: "An animated GIF must be the only attachment" });
    if (images.length - gifs.length > 4) issues.push({ code: "TOO_MANY_IMAGES", field: "media", severity: "error", message: "X allows at most 4 photos per post" });
    for (const m of images) {
      const limit = m.mimeType === "image/gif" ? 15 : 5;
      if (m.sizeBytes > limit * 1024 * 1024) issues.push({ code: "IMAGE_TOO_LARGE", field: "media", severity: "error", message: `${m.mimeType === "image/gif" ? "GIF" : "Image"} exceeds ${limit} MB` });
    }
    for (const m of videos) {
      if (m.sizeBytes > 8 * 1024 ** 3) issues.push({ code: "VIDEO_TOO_LARGE", field: "media", severity: "error", message: "Video exceeds 8 GB (the standard limit)" });
      if (m.durationMs != null && m.durationMs > 20 * 60_000) issues.push({ code: "VIDEO_DURATION", field: "media", severity: "warning", message: "Videos over 20 minutes need an X Premium account" });
    }
    return issues;
  },
};
