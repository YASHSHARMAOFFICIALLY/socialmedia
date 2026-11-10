import { PlatformError, platformFetch } from "../core/errors.js";
import type { PublicPost, PublicProfile, SocialAdapter } from "../core/types.js";

// Verified (docs.x.com): GET /2/users/by/username/{username} with user.fields=public_metrics (followers_count, post_count, ...);
// user timeline GET /2/users/{id}/tweets with tweet.fields=created_at,public_metrics. Only public fields are requested. Needs read access on the app's tier.
const API = "https://api.x.com/2";
const n = (v: unknown) => (typeof v === "number" ? v : null);

export function createXCompetitors(f: typeof fetch = fetch): Pick<SocialAdapter, "lookupPublicProfile" | "fetchPublicPosts"> {
  return {
    async lookupPublicProfile({ accessToken, handle }): Promise<PublicProfile> {
      const user = handle.replace(/^@/, "");
      if (!/^\w{1,15}$/.test(user)) throw new PlatformError("permanent", "That is not a valid X username");
      const res = await platformFetch(f, "x", `${API}/users/by/username/${user}?user.fields=public_metrics,profile_image_url`, { headers: { Authorization: `Bearer ${accessToken}` } });
      const u = ((await res.json()) as { data?: { id: string; name?: string; username?: string; profile_image_url?: string; public_metrics?: Record<string, unknown> } }).data;
      if (!u?.id) throw new PlatformError("permanent", `No X account found for @${user}`);
      return { externalId: u.id, handle: u.username ?? user, displayName: u.name ?? user, ...(u.profile_image_url ? { avatarUrl: u.profile_image_url } : {}), followers: n(u.public_metrics?.followers_count), posts: n(u.public_metrics?.post_count ?? u.public_metrics?.tweet_count) };
    },
    async fetchPublicPosts({ accessToken, profile, limit }): Promise<PublicPost[]> {
      const res = await platformFetch(f, "x", `${API}/users/${profile.externalId}/tweets?max_results=${Math.min(100, Math.max(5, limit))}&exclude=retweets,replies&tweet.fields=created_at,public_metrics`, { headers: { Authorization: `Bearer ${accessToken}` } });
      const list = ((await res.json()) as { data?: { id: string; created_at?: string; public_metrics?: Record<string, unknown> }[] }).data ?? [];
      return list.filter((t) => t.created_at).map((t) => ({
        externalId: t.id, publishedAt: new Date(t.created_at!), url: `https://x.com/${profile.handle}/status/${t.id}`,
        metrics: { likes: n(t.public_metrics?.like_count), comments: n(t.public_metrics?.reply_count), reposts: n(t.public_metrics?.retweet_count), quotes: n(t.public_metrics?.quote_count), impressions: n(t.public_metrics?.impression_count) },
      }));
    },
  };
}
