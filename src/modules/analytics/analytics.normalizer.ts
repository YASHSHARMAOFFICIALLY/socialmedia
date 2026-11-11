import type { Platform, RawMetric } from "../../integrations/core/types.js";

/** Canonical key + the platform's own definition. Anything not listed here is kept only in the raw snapshot. */
interface Mapping { key: string; definition: string }
const m = (key: string, definition: string): Mapping => ({ key, definition });

export const MAPPINGS: Record<Platform, Record<string, Mapping>> = {
  x: {
    "public_metrics.impression_count": m("impressions", "X impression_count: times the post was displayed"),
    "public_metrics.like_count": m("likes", "X like_count"),
    "public_metrics.reply_count": m("comments", "X reply_count (replies)"),
    "public_metrics.retweet_count": m("reposts", "X retweet_count (reposts, excluding quote posts)"),
    "public_metrics.quote_count": m("quotes", "X quote_count"),
    "public_metrics.bookmark_count": m("bookmarks", "X bookmark_count"),
    "non_public_metrics.url_link_clicks": m("clicks", "X non_public_metrics.url_link_clicks (owner-only, limited window after posting)"),
    "non_public_metrics.user_profile_clicks": m("profile_visits", "X non_public_metrics.user_profile_clicks (profile clicks from the post)"),
    "public_metrics.followers_count": m("followers", "X followers_count"),
  },
  youtube: {
    "statistics.viewCount": m("views", "YouTube viewCount: views counted by YouTube (not impressions)"),
    "statistics.likeCount": m("likes", "YouTube likeCount"),
    "statistics.commentCount": m("comments", "YouTube commentCount"),
    "analytics.estimatedMinutesWatched": m("watch_time_seconds", "YouTube Analytics estimatedMinutesWatched (minutes, stored in seconds)"),
    "analytics.averageViewDuration": m("avg_watch_time_seconds", "YouTube Analytics averageViewDuration (seconds)"),
    "analytics.averageViewPercentage": m("avg_view_percentage", "YouTube Analytics averageViewPercentage (percent, stored as a 0-1 ratio)"),
    "analytics.shares": m("shares", "YouTube Analytics shares"),
    "analytics.subscribersGained": m("subscribers_gained", "YouTube Analytics subscribersGained"),
    "statistics.subscriberCount": m("followers", "YouTube subscriberCount (rounded to 3 significant figures by YouTube; hidden if the channel hides it)"),
  },
  instagram: {
    views: m("views", "Instagram views: times the media was played/viewed (replaces impressions for media after 2024-07-02)"),
    reach: m("reach", "Instagram reach: unique accounts that saw the media"),
    likes: m("likes", "Instagram likes (organic only)"),
    comments: m("comments", "Instagram comments (organic only)"),
    saved: m("saves", "Instagram saved"),
    shares: m("shares", "Instagram shares"),
    reposts: m("reposts", "Instagram reposts"),
    profile_visits: m("profile_visits", "Instagram profile_visits attributed to the media"),
    ig_reels_avg_watch_time: m("avg_watch_time_seconds", "Instagram ig_reels_avg_watch_time (reported in milliseconds, stored in seconds)"),
    followers_count: m("followers", "Instagram followers_count"),
    // Account insights (GET /<IG_ID>/insights, period=day, metric_type=total_value): the total for the 24 hours before collection.
    saves: m("saves", "Instagram saves (account insights, last 24 hours)"),
    accounts_engaged: m("accounts_engaged", "Instagram accounts_engaged (account insights, last 24 hours; Meta marks it as an estimate)"),
    profile_links_taps: m("profile_links_taps", "Instagram profile_links_taps (account insights, last 24 hours)"),
  },
  threads: {
    views: m("views", "Threads views: times the post was played or displayed (metric in development per Meta)"),
    likes: m("likes", "Threads likes"),
    replies: m("comments", "Threads replies (root post: total replies)"),
    reposts: m("reposts", "Threads reposts"),
    quotes: m("quotes", "Threads quotes"),
    shares: m("shares", "Threads shares (metric in development per Meta)"),
    followers_count: m("followers", "Threads followers_count"),
  },
  bluesky: {
    likeCount: m("likes", "Bluesky likeCount"),
    repostCount: m("reposts", "Bluesky repostCount"),
    replyCount: m("comments", "Bluesky replyCount"),
    quoteCount: m("quotes", "Bluesky quoteCount"),
    bookmarkCount: m("bookmarks", "Bluesky bookmarkCount"),
    followersCount: m("followers", "Bluesky followersCount"),
  },
  mastodon: {
    favourites_count: m("likes", "Mastodon favourites_count (as seen by the home instance)"),
    reblogs_count: m("reposts", "Mastodon reblogs_count (boosts)"),
    replies_count: m("comments", "Mastodon replies_count"),
    followers_count: m("followers", "Mastodon followers_count"),
  },
  telegram: { member_count: m("followers", "Telegram getChatMemberCount (channel members)") },
  pinterest: { follower_count: m("followers", "Pinterest user_account follower_count") },
  facebook: {}, // no Page insights claimed (not verified)
  tiktok: {},   // no analytics implemented
  linkedin: {}, // LinkedIn exposes no analytics to this app (member post statistics need partner access)
};

const COMPONENTS = ["likes", "comments", "shares", "reposts", "quotes", "saves", "bookmarks"] as const;

export interface NormalizedMetric {
  key: string; originalName: string; definition: string | null; value: number | null;
  availability: "available" | "unavailable"; period: "lifetime" | "day"; components?: string[];
}

/**
 * Pure. Maps platform metrics to the canonical vocabulary, converting units where the platform's unit differs.
 * Unavailable stays unavailable (never becomes 0). `interactions` is derived from the components the platform actually reported.
 */
export function normalize(platform: Platform, raw: RawMetric[], scope: "post" | "account"): NormalizedMetric[] {
  const out: NormalizedMetric[] = [];
  for (const r of raw) {
    const map = MAPPINGS[platform][r.originalName];
    if (!map) continue;
    const value = r.availability === "available" && r.value !== null ? (r.originalName === "ig_reels_avg_watch_time" ? r.value / 1000 : r.originalName === "analytics.estimatedMinutesWatched" ? r.value * 60 : r.originalName === "analytics.averageViewPercentage" ? r.value / 100 : r.value) : null;
    out.push({ key: map.key, originalName: r.originalName, definition: map.definition, value, availability: value === null ? "unavailable" : "available", period: r.period ?? "lifetime" });
  }
  if (scope === "post") {
    const comps = out.filter((x) => (COMPONENTS as readonly string[]).includes(x.key));
    if (comps.length > 0) {
      const present = comps.filter((c) => c.value !== null);
      const total = present.reduce((s, c) => s + c.value!, 0);
      out.push({
        key: "interactions", originalName: "(derived)", definition: "Sum of the interaction components this platform reported", period: "lifetime",
        value: present.length ? total : null, availability: present.length ? "available" : "unavailable", components: present.map((c) => c.key),
      });
    }
  }
  return out;
}

/** Engagement rate = interactions / the best available audience denominator. The denominator is always reported with the rate. */
export function engagementRate(latest: Record<string, number | null | undefined>): { rate: number; denominator: "impressions" | "reach" | "views" } | null {
  const interactions = latest.interactions;
  if (interactions == null) return null;
  for (const d of ["impressions", "reach", "views"] as const) {
    const v = latest[d];
    if (v != null && v > 0) return { rate: interactions / v, denominator: d };
  }
  return null;
}

/** Collection cadence: fresh posts change fast, old ones slowly; null = stop collecting. */
export function nextCollectionDelayS(scope: "post" | "account", ageS: number): number | null {
  if (scope === "account") return 24 * 3600;
  if (ageS < 24 * 3600) return 3600;
  if (ageS < 7 * 86400) return 6 * 3600;
  if (ageS < 30 * 86400) return 24 * 3600;
  if (ageS < 90 * 86400) return 7 * 86400;
  return null;
}
