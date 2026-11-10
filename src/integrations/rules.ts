import type { ContentRules } from "./core/rules.js";
import type { Platform } from "./core/types.js";
import { instagramRules } from "./instagram/instagram.rules.js";
import { linkedinRules } from "./linkedin/linkedin.rules.js";
import { blueskyRules } from "./bluesky/bluesky.rules.js";
import { facebookRules } from "./facebook/facebook.rules.js";
import { mastodonRules } from "./mastodon/mastodon.rules.js";
import { pinterestRules } from "./pinterest/pinterest.rules.js";
import { telegramRules } from "./telegram/telegram.rules.js";
import { threadsRules } from "./threads/threads.rules.js";
import { tiktokRules } from "./tiktok/tiktok.rules.js";
import { xRules } from "./x/x.rules.js";
import { youtubeRules } from "./youtube/youtube.rules.js";

/** Pure, offline content rules for every supported platform (independent of whether credentials are configured). */
export const contentRules: Record<Platform, ContentRules> = { instagram: instagramRules, x: xRules, linkedin: linkedinRules, youtube: youtubeRules, threads: threadsRules, facebook: facebookRules, pinterest: pinterestRules, tiktok: tiktokRules, bluesky: blueskyRules, mastodon: mastodonRules, telegram: telegramRules };
