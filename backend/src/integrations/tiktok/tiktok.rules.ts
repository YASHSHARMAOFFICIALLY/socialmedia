import { chars, mediaOnly, withHashtags, type ContentRules, type Issue } from "../core/rules.js";

// Content Posting API (direct post) publishes ONE video pulled from a URL. privacy_level must be one of the creator's own options
// (queried at publish time), so only its presence is checked here. Title length limit is not confirmed from first-party docs: warning only.
export const tiktokRules: ContentRules = {
  platform: "tiktok",
  validate(c) {
    const issues: Issue[] = [];
    const media = mediaOnly(c);
    if (media.length !== 1 || media[0]!.kind !== "video") issues.push({ code: "ONE_VIDEO", field: "media", severity: "error", message: "A TikTok post here needs exactly one video (photo posts are not implemented)" });
    if (typeof c.metadata.privacy !== "string") issues.push({ code: "PRIVACY_REQUIRED", field: "metadata.privacy", severity: "error", message: "TikTok needs metadata.privacy (one of the creator's privacy_level_options, e.g. SELF_ONLY)" });
    if (chars(withHashtags(c)) > 2200) issues.push({ code: "TITLE_LONG_UNVERIFIED", field: "caption", severity: "warning", message: "Title/caption is over 2,200 characters (limit not confirmed from first-party docs)" });
    return issues;
  },
};
