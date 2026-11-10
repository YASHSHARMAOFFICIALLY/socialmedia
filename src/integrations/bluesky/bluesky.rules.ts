import { mediaOnly, withHashtags, type ContentRules, type Issue } from "../core/rules.js";

// Verified (app.bsky.feed.post / app.bsky.embed.images lexicons): text <= 300 graphemes (and <= 3000 bytes); up to 4 images,
// each <= 2,000,000 bytes, image/*. Video embeds are not implemented by this integration.
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
    if (media.some((m) => m.kind === "video")) issues.push({ code: "VIDEO_UNSUPPORTED", field: "media", severity: "error", message: "Video posting to Bluesky is not implemented; use images" });
    const images = media.filter((m) => m.kind === "image");
    if (images.length > 4) issues.push({ code: "TOO_MANY_IMAGES", field: "media", severity: "error", message: "Bluesky allows at most 4 images per post" });
    for (const m of images) if (m.sizeBytes > BLUESKY_MAX_IMAGE_BYTES) issues.push({ code: "IMAGE_TOO_LARGE", field: "media", severity: "error", message: "Bluesky images must be at most 2,000,000 bytes" });
    return issues;
  },
};
