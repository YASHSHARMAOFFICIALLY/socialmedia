import { chars, mediaOnly, withHashtags, type ContentRules, type Issue } from "../core/rules.js";

// Verified (Pinterest API v5 OpenAPI spec, PinCreate): title <= 100, description <= 800, link <= 2048, alt_text <= 500,
// board_id (digits) required. One image pin from a URL, or one video pin (media-upload flow, UNVERIFIED: needs a thumbnail-role cover image; MP4/MOV/M4V is the documented family, size cap below is a conservative guard because the adapter buffers the file).
export const pinterestRules: ContentRules = {
  platform: "pinterest",
  validate(c) {
    const issues: Issue[] = [];
    const media = mediaOnly(c);
    const text = withHashtags(c);
    const title = c.title ?? "";
    if (!/^\d+$/.test(String(c.metadata.boardId ?? ""))) issues.push({ code: "BOARD_REQUIRED", field: "metadata.boardId", severity: "error", message: "Pinterest pins need metadata.boardId (numeric board id)" });
    const video = media.find((m) => m.kind === "video");
    if (media.length !== 1) issues.push({ code: "ONE_MEDIA", field: "media", severity: "error", message: "A Pinterest pin needs exactly one image or one video" });
    if (video) {
      if (!c.media.some((m) => m.role === "thumbnail" && m.kind === "image")) issues.push({ code: "VIDEO_NEEDS_COVER", field: "media", severity: "error", message: "A Pinterest video pin needs a cover image (attach an image with role thumbnail)" });
      if (video.sizeBytes > 100 * 1024 * 1024) issues.push({ code: "VIDEO_TOO_LARGE", field: "media", severity: "warning", message: "Videos over 100 MB are buffered in memory and may fail" });
    }
    if (chars(title) > 100) issues.push({ code: "TITLE_LONG", field: "title", severity: "error", message: "Pin title must be at most 100 characters" });
    if (chars(text) > 800) issues.push({ code: "DESC_LONG", field: "caption", severity: "error", message: `Description is ${chars(text)} characters; Pinterest allows 800` });
    if (c.metadata.link !== undefined && String(c.metadata.link).length > 2048) issues.push({ code: "LINK_LONG", field: "metadata.link", severity: "error", message: "Link must be at most 2048 characters" });
    if (c.metadata.altText !== undefined && chars(String(c.metadata.altText)) > 500) issues.push({ code: "ALT_LONG", field: "metadata.altText", severity: "error", message: "Alt text must be at most 500 characters" });
    return issues;
  },
};
