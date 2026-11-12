import { chars, mediaOnly, withHashtags, type ContentRules, type Issue } from "../core/rules.js";

// Official (Instagram Platform docs): caption max 2,200 chars, 30 hashtags, 20 @-tags (error-codes reference); JPEG is the only image format;
// carousels hold up to 20 items; videos publish as Reels. Carousels may mix images and videos.
// UNVERIFIED: Reels duration/codec/size limits => warning only.
export const instagramRules: ContentRules = {
  platform: "instagram",
  validate(c) {
    const issues: Issue[] = [];
    const text = withHashtags(c);
    const media = mediaOnly(c);
    if (media.length === 0) issues.push({ code: "MEDIA_REQUIRED", field: "media", severity: "error", message: "Instagram posts require at least one image or video" });
    if (chars(text) > 2200) issues.push({ code: "CAPTION_TOO_LONG", field: "caption", severity: "error", message: `Caption is ${chars(text)} characters (including hashtags); max 2,200` });
    const tags = text.match(/(^|\s)#[\p{L}\p{N}_]+/gu)?.length ?? 0;
    if (tags > 30) issues.push({ code: "TOO_MANY_HASHTAGS", field: "hashtags", severity: "error", message: `${tags} hashtags; max 30` });
    const mentions = text.match(/(^|\s)@[\w.]+/g)?.length ?? 0;
    if (mentions > 20) issues.push({ code: "TOO_MANY_MENTIONS", field: "caption", severity: "error", message: `${mentions} @-mentions; max 20` });
    for (const m of media.filter((m) => m.kind === "image" && m.mimeType !== "image/jpeg"))
      issues.push({ code: "IMAGE_FORMAT", field: "media", severity: "error", message: `${m.mimeType} is not supported: Instagram publishing accepts JPEG only` });
    if (media.length > 20) issues.push({ code: "TOO_MANY_ITEMS", field: "media", severity: "error", message: "A carousel holds at most 20 items" });
    if (media.some((m) => m.kind === "video")) issues.push({ code: "VIDEO_SPECS_UNVERIFIED", field: "media", severity: "warning", message: "Reels/video duration, codec and size limits are not verified" });
    return issues;
  },
};
