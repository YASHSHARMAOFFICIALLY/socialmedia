import { chars, mediaOnly, withHashtags, type ContentRules, type Issue } from "../core/rules.js";

// Verified (LinkedIn Images/Videos/MultiImage API docs): images JPG/GIF/PNG, < 36,152,320 pixels; multi-image posts take 2-20 images;
// video is MP4, 3 s to 30 min, 75 KB to 500 MB; a post carries one video OR images.
// NOT in official docs (third-party only): the ~3,000 character commentary limit => warning.
const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/gif"]);
export const linkedinRules: ContentRules = {
  platform: "linkedin",
  validate(c) {
    const issues: Issue[] = [];
    const text = withHashtags(c);
    const media = mediaOnly(c);
    const images = media.filter((m) => m.kind === "image"), videos = media.filter((m) => m.kind === "video");
    if (!text && media.length === 0) issues.push({ code: "EMPTY", field: "caption", severity: "error", message: "Post needs text or media" });
    if (chars(text) > 3000) issues.push({ code: "TEXT_LONG_UNVERIFIED", field: "caption", severity: "warning", message: `Text is ${chars(text)} characters; ~3,000 is the commonly reported limit (not in official docs)` });
    if (videos.length > 1) issues.push({ code: "TOO_MANY_VIDEOS", field: "media", severity: "error", message: "LinkedIn posts can contain one video" });
    if (videos.length > 0 && images.length > 0) issues.push({ code: "MIXED_MEDIA", field: "media", severity: "error", message: "LinkedIn posts carry either one video or images, not both" });
    if (images.length > 20) issues.push({ code: "TOO_MANY_IMAGES", field: "media", severity: "error", message: "LinkedIn allows at most 20 images per post" });
    for (const m of images) {
      if (!IMAGE_MIME.has(m.mimeType)) issues.push({ code: "IMAGE_FORMAT", field: "media", severity: "error", message: `${m.mimeType} is not supported; use JPG, PNG or GIF` });
      if (m.width && m.height && m.width * m.height >= 36_152_320) issues.push({ code: "IMAGE_TOO_LARGE", field: "media", severity: "error", message: "Image must have fewer than 36,152,320 pixels" });
    }
    for (const m of videos) {
      if (m.mimeType !== "video/mp4") issues.push({ code: "VIDEO_FORMAT", field: "media", severity: "error", message: "LinkedIn video must be MP4" });
      if (m.sizeBytes < 75 * 1024) issues.push({ code: "VIDEO_TOO_SMALL", field: "media", severity: "error", message: "Video must be at least 75 KB" });
      if (m.sizeBytes > 500 * 1024 * 1024) issues.push({ code: "VIDEO_TOO_LARGE", field: "media", severity: "error", message: "Video must be at most 500 MB" });
      if (m.durationMs != null && (m.durationMs < 3000 || m.durationMs > 30 * 60_000)) issues.push({ code: "VIDEO_DURATION", field: "media", severity: "error", message: "Video must be between 3 seconds and 30 minutes" });
    }
    return issues;
  },
};
