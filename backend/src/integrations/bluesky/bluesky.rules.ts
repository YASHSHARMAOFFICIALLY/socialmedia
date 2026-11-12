import { mediaOnly, withHashtags, type ContentRules, type Issue } from "../core/rules.js";

// Verified (app.bsky.feed.post / app.bsky.embed.images lexicons): text <= 300 graphemes (and <= 3000 bytes); up to 4 images,
// each <= 2,000,000 bytes, image/*. One video (UNVERIFIED limits: size/duration are not in the official tutorial; mp4 only per the embed lexicon per third-party sources) replaces images.
export const BLUESKY_MAX_GRAPHEMES = 300;
export const BLUESKY_MAX_IMAGE_BYTES = 2_000_000;
export const graphemes = (s: string) => [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)].length;

export const blueskyRules: ContentRules = {
  platform: "bluesky",
  validate(c) {
    const issues: Issue[] = [];
    const text = withHashtags(c);
    const media = mediaOnly(c);
    if (!text && media.length === 0) issues.push({ code: "EMPTY", field: "caption", severity: "error", message: "Post needs text or an image" });
    if (graphemes(text) > BLUESKY_MAX_GRAPHEMES) issues.push({ code: "TEXT_LONG", field: "caption", severity: "error", message: `Text is ${graphemes(text)} graphemes; Bluesky allows ${BLUESKY_MAX_GRAPHEMES}` });
    const videos = media.filter((m) => m.kind === "video");
    if (videos.length > 1 || (videos.length === 1 && media.length > 1)) issues.push({ code: "ONE_VIDEO", field: "media", severity: "error", message: "A Bluesky post carries either up to 4 images or one video" });
    for (const v of videos) if (v.mimeType !== "video/mp4") issues.push({ code: "VIDEO_FORMAT", field: "media", severity: "warning", message: "Bluesky video embeds are documented as video/mp4; other formats may be rejected" });
    const images = media.filter((m) => m.kind === "image");
    if (images.length > 4) issues.push({ code: "TOO_MANY_IMAGES", field: "media", severity: "error", message: "Bluesky allows at most 4 images per post" });
    for (const m of images) if (m.sizeBytes > BLUESKY_MAX_IMAGE_BYTES) issues.push({ code: "IMAGE_TOO_LARGE", field: "media", severity: "error", message: "Bluesky images must be at most 2,000,000 bytes" });
    return issues;
  },
};
