import { chars, mediaOnly, withHashtags, type ContentRules, type Issue } from "../core/rules.js";

// Verified (docs.joinmastodon.org): limits are PER INSTANCE (GET /api/v2/instance: statuses.max_characters, max_media_attachments,
// media_attachments.*), so a character/media overrun is a warning here; publish enforces the connected instance's real limits.
// Defaults are the Mastodon software defaults (500 characters, 4 attachments).
export const MASTODON_VISIBILITY = ["public", "unlisted", "private", "direct"] as const;
export const mastodonRules: ContentRules = {
  platform: "mastodon",
  validate(c) {
    const issues: Issue[] = [];
    const text = withHashtags(c);
    const media = mediaOnly(c);
    if (!text && media.length === 0) issues.push({ code: "EMPTY", field: "caption", severity: "error", message: "Post needs text or media" });
    if (chars(text) > 500) issues.push({ code: "TEXT_LONG_DEFAULT", field: "caption", severity: "warning", message: `Text is ${chars(text)} characters; the default instance limit is 500 (your instance may differ)` });
    if (media.length > 4) issues.push({ code: "TOO_MANY_MEDIA", field: "media", severity: "warning", message: "The default instance limit is 4 attachments (your instance may differ)" });
    const v = c.metadata.visibility;
    if (v !== undefined && !(MASTODON_VISIBILITY as readonly unknown[]).includes(v)) issues.push({ code: "VISIBILITY", field: "metadata.visibility", severity: "error", message: `visibility must be one of ${MASTODON_VISIBILITY.join(", ")}` });
    return issues;
  },
};
