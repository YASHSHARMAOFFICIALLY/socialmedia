import { mediaOnly, withHashtags, type ContentRules, type Issue } from "../core/rules.js";

// Verified (Threads API "Posts" docs): text <= 500 characters, with emoji counted as their UTF-8 byte length; a carousel holds 2-20 images/videos;
// text-only, single image, single video and carousel are supported. Media must be reachable at a public URL (Threads downloads it).
export const threadsLength = (s: string) => [...s].reduce((n, ch) => n + (/\p{Extended_Pictographic}/u.test(ch) ? new TextEncoder().encode(ch).length : 1), 0);

export const threadsRules: ContentRules = {
  platform: "threads",
  validate(c) {
    const issues: Issue[] = [];
    const text = withHashtags(c);
    const media = mediaOnly(c);
    if (!text && media.length === 0) issues.push({ code: "EMPTY", field: "caption", severity: "error", message: "Post needs text or media" });
    if (threadsLength(text) > 500) issues.push({ code: "TEXT_LONG", field: "caption", severity: "error", message: `Text counts ${threadsLength(text)} of 500 (emoji count as their UTF-8 bytes)` });
    if (media.length > 20) issues.push({ code: "TOO_MANY_MEDIA", field: "media", severity: "error", message: "A Threads carousel holds at most 20 items" });
    return issues;
  },
};
