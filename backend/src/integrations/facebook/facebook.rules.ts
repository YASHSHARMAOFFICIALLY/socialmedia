import { chars, mediaOnly, withHashtags, type ContentRules, type Issue } from "../core/rules.js";

// Verified (Pages API "Posts", Page /photos, /videos references): text via /feed `message`; photos via /photos `url`; multi-photo via
// attached_media on /feed; video via /videos `file_url`. Facebook documents no hard text limit on these pages, so none is enforced.
export const facebookRules: ContentRules = {
  platform: "facebook",
  validate(c) {
    const issues: Issue[] = [];
    const media = mediaOnly(c);
    const images = media.filter((m) => m.kind === "image"), videos = media.filter((m) => m.kind === "video");
    if (!withHashtags(c) && media.length === 0) issues.push({ code: "EMPTY", field: "caption", severity: "error", message: "Post needs text or media" });
    if (videos.length > 1) issues.push({ code: "TOO_MANY_VIDEOS", field: "media", severity: "error", message: "A Facebook post carries one video" });
    if (videos.length && images.length) issues.push({ code: "MIXED_MEDIA", field: "media", severity: "error", message: "A Facebook post carries either one video or photos, not both" });
    if (chars(withHashtags(c)) > 63_206) issues.push({ code: "TEXT_LONG_UNVERIFIED", field: "caption", severity: "warning", message: "Over the commonly reported 63,206-character limit (not in the Pages API docs)" });
    return issues;
  },
};
