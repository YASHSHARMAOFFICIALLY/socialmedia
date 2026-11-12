import { chars, mediaOnly, withHashtags, type ContentRules, type Issue } from "../core/rules.js";

// Verified (core.telegram.org/bots/api): sendMessage text 1-4096 characters; sendPhoto/sendVideo caption 0-1024 characters.
// When Telegram downloads a file from an HTTP URL (how this integration sends media): photos <= 5 MB, other content <= 20 MB.
// Albums (sendMediaGroup) hold 2-10 items; the caption goes on the first item. Text is sent as plain text (no parse_mode).
export const telegramRules: ContentRules = {
  platform: "telegram",
  validate(c) {
    const issues: Issue[] = [];
    const text = withHashtags(c);
    const media = mediaOnly(c);
    if (!text && media.length === 0) issues.push({ code: "EMPTY", field: "caption", severity: "error", message: "Post needs text or media" });
    if (media.length > 10) issues.push({ code: "TOO_MANY_MEDIA", field: "media", severity: "error", message: "A Telegram album holds at most 10 items" });
    const limit = media.length ? 1024 : 4096;
    if (chars(text) > limit) issues.push({ code: "TEXT_LONG", field: "caption", severity: "error", message: `Text is ${chars(text)} characters; Telegram allows ${limit}${media.length ? " in a media caption" : ""}` });
    for (const m of media) {
      if (m.kind === "image" && m.sizeBytes > 5 * 1024 * 1024) issues.push({ code: "IMAGE_TOO_LARGE", field: "media", severity: "error", message: "Photos sent by URL must be at most 5 MB" });
      if (m.kind === "video" && m.sizeBytes > 20 * 1024 * 1024) issues.push({ code: "VIDEO_TOO_LARGE", field: "media", severity: "error", message: "Videos sent by URL must be at most 20 MB" });
      if (m.kind === "video" && m.mimeType !== "video/mp4") issues.push({ code: "VIDEO_FORMAT", field: "media", severity: "error", message: "Telegram supports MPEG4 video (other formats are sent as documents)" });
    }
    return issues;
  },
};
