import { PlatformError, platformFetch } from "../core/errors.js";
import type { OAuthTokens, SocialAdapter } from "../core/types.js";

// Verified (Meta "Instagram API with Instagram Login" / Business Login docs):
//  authorize: https://www.instagram.com/oauth/authorize (client_id, redirect_uri, response_type=code, scope)
//  code -> short-lived token: POST https://api.instagram.com/oauth/access_token (form) => { data: [{ access_token, user_id, permissions }] }
//  short -> long-lived (60 days): GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret&access_token
//  refresh: GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token  (token >= 24h old and unexpired)
// Instagram has no separate refresh token: the long-lived token is stored as both access and "refresh" credential.
const AUTH_URL = "https://www.instagram.com/oauth/authorize";
export const INSTAGRAM_SCOPES = ["instagram_business_basic", "instagram_business_content_publish", "instagram_business_manage_insights"];
export const GRAPH = "https://graph.instagram.com";

interface Long { access_token: string; expires_in: number }

export function createInstagramAuth(cfg: { clientId: string; clientSecret: string }, f: typeof fetch = fetch): Pick<SocialAdapter, "oauth" | "fetchAccount"> {
  const toTokens = (t: Long, scopes: string[], now = Date.now()): OAuthTokens => ({ accessToken: t.access_token, refreshToken: t.access_token, expiresAt: new Date(now + t.expires_in * 1000), scopes });
  return {
    oauth: {
      usesPkce: false,
      authorizationUrl: ({ state, redirectUri }) =>
        `${AUTH_URL}?${new URLSearchParams({ client_id: cfg.clientId, redirect_uri: redirectUri, response_type: "code", scope: INSTAGRAM_SCOPES.join(","), state })}`,
      async exchangeCode({ code, redirectUri }) {
        const shortRes = await platformFetch(f, "instagram", "https://api.instagram.com/oauth/access_token", {
          method: "POST", body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: "authorization_code", redirect_uri: redirectUri, code }),
        });
        const short = ((await shortRes.json()) as { data?: { access_token: string; permissions?: string }[] }).data?.[0];
        if (!short?.access_token) throw new PlatformError("permanent", "instagram token response missing access_token");
        const longRes = await platformFetch(f, "instagram", `${GRAPH}/access_token?${new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: cfg.clientSecret, access_token: short.access_token })}`, {});
        const long = (await longRes.json()) as Long;
        if (!long.access_token) throw new PlatformError("permanent", "instagram long-lived token exchange failed");
        return toTokens(long, (short.permissions ?? "").split(",").map((s) => s.trim()).filter(Boolean));
      },
      async refresh(current) {
        const res = await platformFetch(f, "instagram", `${GRAPH}/refresh_access_token?${new URLSearchParams({ grant_type: "ig_refresh_token", access_token: current })}`, {});
        const t = (await res.json()) as Long;
        if (!t.access_token) throw new PlatformError("permanent", "instagram refresh failed");
        return toTokens(t, []); // scopes unchanged: caller keeps the stored list when none are returned
      },
    },
    async fetchAccount(accessToken) {
      const res = await platformFetch(f, "instagram", `${GRAPH}/me?${new URLSearchParams({ fields: "user_id,username,name,account_type,profile_picture_url", access_token: accessToken })}`, {});
      const body = (await res.json()) as { user_id?: string; id?: string; username?: string; name?: string; account_type?: string; profile_picture_url?: string; data?: { user_id?: string; id?: string; username?: string; name?: string; account_type?: string; profile_picture_url?: string }[] };
      const u = body.data?.[0] ?? body;
      const id = u.user_id ?? u.id;
      if (!id) throw new PlatformError("permanent", "instagram /me returned no user id");
      return { externalId: String(id), displayName: u.name ?? u.username ?? "Instagram account", ...(u.username ? { username: u.username } : {}), ...(u.profile_picture_url ? { avatarUrl: u.profile_picture_url } : {}), accountType: "business", metadata: { igAccountType: u.account_type ?? null } };
    },
  };
}
