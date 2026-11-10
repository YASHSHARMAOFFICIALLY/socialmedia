import { PlatformError, platformFetch } from "../core/errors.js";
import type { OAuthTokens, SocialAdapter } from "../core/types.js";

// Verified (Google OAuth 2.0 web-server + YouTube Data API docs): auth endpoint accounts.google.com/o/oauth2/v2/auth with
// access_type=offline (refresh token) and prompt=consent; token endpoint oauth2.googleapis.com/token; upload scope youtube.upload.
// A refresh response does NOT include a new refresh token: the stored one stays valid (our credential upsert keeps it).
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const YOUTUBE_SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly", "https://www.googleapis.com/auth/yt-analytics.readonly"];

interface TokenResponse { access_token: string; expires_in: number; refresh_token?: string; scope?: string; refresh_token_expires_in?: number }
interface ChannelList { items?: { id: string; snippet?: { title?: string; customUrl?: string; thumbnails?: { default?: { url?: string } } }; contentDetails?: { relatedPlaylists?: { uploads?: string } } }[] }

const toTokens = (t: TokenResponse, now = Date.now()): OAuthTokens => ({
  accessToken: t.access_token,
  ...(t.refresh_token ? { refreshToken: t.refresh_token } : {}),
  expiresAt: new Date(now + t.expires_in * 1000),
  scopes: (t.scope ?? "").split(/\s+/).filter(Boolean),
});

export function createYouTubeAuth(cfg: { clientId: string; clientSecret: string }, f: typeof fetch = fetch): Pick<SocialAdapter, "oauth" | "fetchAccount"> {
  const tokenRequest = async (params: Record<string, string>) => {
    const res = await platformFetch(f, "youtube", TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...params, client_id: cfg.clientId, client_secret: cfg.clientSecret }) });
    const body = (await res.json()) as TokenResponse;
    if (!body.access_token) throw new PlatformError("permanent", "youtube token response missing access_token");
    return toTokens(body);
  };
  return {
    oauth: {
      usesPkce: false,
      authorizationUrl: ({ state, redirectUri }) =>
        `${AUTH_URL}?${new URLSearchParams({ response_type: "code", client_id: cfg.clientId, redirect_uri: redirectUri, scope: YOUTUBE_SCOPES.join(" "), state, access_type: "offline", prompt: "consent" })}`,
      exchangeCode: ({ code, redirectUri }) => tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
      refresh: (refreshToken) => tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }),
    },
    async fetchAccount(accessToken) {
      const res = await platformFetch(f, "youtube", "https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails&mine=true", { headers: { Authorization: `Bearer ${accessToken}` } });
      const ch = ((await res.json()) as ChannelList).items?.[0];
      if (!ch) throw new PlatformError("permanent", "This Google account has no YouTube channel");
      return {
        externalId: ch.id, displayName: ch.snippet?.title ?? "YouTube channel",
        ...(ch.snippet?.customUrl ? { username: ch.snippet.customUrl } : {}),
        ...(ch.snippet?.thumbnails?.default?.url ? { avatarUrl: ch.snippet.thumbnails.default.url } : {}),
        accountType: "channel",
        metadata: { uploadsPlaylistId: ch.contentDetails?.relatedPlaylists?.uploads ?? null },
      };
    },
  };
}
