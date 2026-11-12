import { bytes, chars, mediaOnly, type ContentRules, type Issue } from "../core/rules.js";

// Official (YouTube Data API videos resource): title <= 100 chars, description <= 5000 BYTES, neither may contain < or >.
// UNVERIFIED: tags total <= 500 chars (third-party) => warning.
export const youtubeRules: ContentRules = {
  platform: "youtube",
  validate(c) {
    const issues: Issue[] = [];
    const desc = c.description ?? c.text;
    const videos = mediaOnly(c).filter((m) => m.kind === "video");
    // YouTube's own release timer: the video is uploaded private and YouTube makes it public at publishAt (requires privacyStatus private).
    const at = c.metadata.publishAt;
    if (at !== undefined) {
      if (typeof at !== "string" || Number.isNaN(Date.parse(at))) issues.push({ code: "PUBLISH_AT_INVALID", field: "metadata", severity: "error", message: "metadata.publishAt must be an ISO 8601 date-time" });
      else if (Date.parse(at) <= Date.now()) issues.push({ code: "PUBLISH_AT_PAST", field: "metadata", severity: "error", message: "metadata.publishAt must be in the future" });
      if (c.metadata.privacyStatus !== undefined && c.metadata.privacyStatus !== "private") issues.push({ code: "PUBLISH_AT_PRIVACY", field: "metadata", severity: "error", message: "publishAt only works with privacyStatus 'private' (YouTube makes it public at that time)" });
    }
    if (videos.length !== 1 || mediaOnly(c).length !== 1) issues.push({ code: "VIDEO_REQUIRED", field: "media", severity: "error", message: "YouTube requires exactly one video file" });
    if (!c.title?.trim()) issues.push({ code: "TITLE_REQUIRED", field: "title", severity: "error", message: "YouTube requires a title" });
    else if (chars(c.title) > 100) issues.push({ code: "TITLE_TOO_LONG", field: "title", severity: "error", message: `Title is ${chars(c.title)} characters; max 100` });
    if (/[<>]/.test(c.title ?? "")) issues.push({ code: "TITLE_INVALID_CHARS", field: "title", severity: "error", message: "Title cannot contain < or >" });
    if (bytes(desc) > 5000) issues.push({ code: "DESCRIPTION_TOO_LONG", field: "description", severity: "error", message: `Description is ${bytes(desc)} bytes; max 5000 bytes` });
    if (/[<>]/.test(desc)) issues.push({ code: "DESCRIPTION_INVALID_CHARS", field: "description", severity: "error", message: "Description cannot contain < or >" });
    const tagChars = c.hashtags.join(",").length;
    if (tagChars > 500) issues.push({ code: "TAGS_LONG_UNVERIFIED", field: "hashtags", severity: "warning", message: `Tags total ${tagChars} characters; ~500 is the commonly reported limit (not confirmed)` });
    const thumbs = c.media.filter((m) => m.role === "thumbnail");
    for (const th of thumbs) {
      if (th.kind !== "image" || !["image/jpeg", "image/png"].includes(th.mimeType)) issues.push({ code: "THUMBNAIL_FORMAT", field: "media", severity: "error", message: "Thumbnails must be JPEG or PNG images (thumbnails.set media types)" });
      else if (th.sizeBytes > 2 * 1024 * 1024) issues.push({ code: "THUMBNAIL_SIZE_UNVERIFIED", field: "media", severity: "warning", message: "Thumbnails over 2 MB are commonly rejected (limit not in the pages consulted); the video still publishes if the thumbnail fails" });
    }
    if (thumbs.length > 0) issues.push({ code: "THUMBNAIL_CHANNEL_UNVERIFIED", field: "media", severity: "warning", message: "Custom thumbnails may require a verified YouTube channel; if YouTube refuses, the video is published without it and a warning is recorded" });
    if (videos[0] && videos[0].sizeBytes > 256 * 1024 ** 3) issues.push({ code: "VIDEO_TOO_LARGE", field: "media", severity: "error", message: "YouTube accepts files up to 256 GB" });
    if (thumbs.length > 1) issues.push({ code: "TOO_MANY_THUMBNAILS", field: "media", severity: "error", message: "At most one thumbnail" });
    return issues;
  },
};
