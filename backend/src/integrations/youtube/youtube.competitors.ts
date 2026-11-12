import { PlatformError } from "../core/errors.js";
import type { PublicPost, PublicProfile, SocialAdapter } from "../core/types.js";
import { toYouTubeError } from "./youtube.publisher.js";

// Verified (YouTube Data API channels.list): `id` or `forHandle` selects the channel, parts snippet/statistics/contentDetails, cost 1 unit.
// Posts = the channel's uploads playlist (playlistItems.list) + videos.list statistics. All data is public.
const BASE = "https://www.googleapis.com/youtube/v3";
const num = (v: unknown) => (typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

/** Accepts a channel URL, @handle, or channel id. */
export function parseChannelRef(input: string): { id: string } | { handle: string } | null {
  const s = input.trim();
  const id = /(?:^|\/channel\/)(UC[\w-]{22})(?:$|[/?#])/.exec(s)?.[1];
  if (id) return { id };
  const handle = /(?:youtube\.com\/)?@([\w.-]{3,30})/.exec(s)?.[1] ?? (/^[\w.-]{3,30}$/.test(s) ? s : undefined);
  return handle ? { handle } : null;
}

export function createYouTubeCompetitors(f: typeof fetch = fetch): Pick<SocialAdapter, "lookupPublicProfile" | "fetchPublicPosts"> {
  const get = async (url: string, token: string) => { const r = await f(url, { headers: { Authorization: `Bearer ${token}` } }); if (!r.ok) throw await toYouTubeError(r, false); return r.json() as Promise<any>; };
  return {
    async lookupPublicProfile({ accessToken, handle }): Promise<PublicProfile> {
      const ref = parseChannelRef(handle);
      if (!ref) throw new PlatformError("permanent", "Provide a channel URL, @handle or channel id");
      const q = "id" in ref ? `id=${ref.id}` : `forHandle=${encodeURIComponent("@" + ref.handle)}`;
      const ch = (await get(`${BASE}/channels?part=snippet,statistics,contentDetails&${q}`, accessToken)).items?.[0];
      if (!ch) throw new PlatformError("permanent", "No YouTube channel found");
      return {
        externalId: ch.id, handle: ch.snippet?.customUrl ?? ch.id, displayName: ch.snippet?.title ?? "YouTube channel", ...(ch.snippet?.thumbnails?.default?.url ? { avatarUrl: ch.snippet.thumbnails.default.url } : {}),
        followers: ch.statistics?.hiddenSubscriberCount ? null : num(ch.statistics?.subscriberCount), posts: num(ch.statistics?.videoCount),
        extra: { totalViews: num(ch.statistics?.viewCount) }, ...(ch.contentDetails?.relatedPlaylists?.uploads ? { uploadsPlaylistId: ch.contentDetails.relatedPlaylists.uploads } : {}),
      };
    },
    async fetchPublicPosts({ accessToken, profile, limit }): Promise<PublicPost[]> {
      if (!profile.uploadsPlaylistId) return [];
      const items = (await get(`${BASE}/playlistItems?part=contentDetails&maxResults=${Math.min(50, limit)}&playlistId=${encodeURIComponent(profile.uploadsPlaylistId)}`, accessToken)).items ?? [];
      const ids = items.map((i: any) => i.contentDetails?.videoId).filter(Boolean);
      if (!ids.length) return [];
      const vids = (await get(`${BASE}/videos?part=snippet,statistics&id=${ids.join(",")}`, accessToken)).items ?? [];
      return vids.filter((v: any) => v.snippet?.publishedAt).map((v: any) => ({
        externalId: v.id, publishedAt: new Date(v.snippet.publishedAt), url: `https://www.youtube.com/watch?v=${v.id}`,
        metrics: { views: num(v.statistics?.viewCount), likes: num(v.statistics?.likeCount), comments: num(v.statistics?.commentCount) },
      }));
    },
  };
}
