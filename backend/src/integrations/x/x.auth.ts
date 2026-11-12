import { PlatformError, platformFetch } from "../core/errors.js";
import type { OAuthTokens, SocialAdapter } from "../core/types.js";

// Verified (docs.x.com OAuth 2.0 Authorization Code with PKCE): authorize at x.com/i/oauth2/authorize (S256 PKCE required),
// token at api.x.com/2/oauth2/token, refresh tokens only with the offline.access scope, media upload needs media.write.
const AUTH_URL = "https://x.com/i/oauth2/authorize";
const TOKEN_URL = "https://api.x.com/2/oauth2/token";
export const X_SCOPES = ["tweet.read", "tweet.write", "users.read", "media.write", "offline.access"];

interface TokenResponse { access_token: string; expires_in: number; refresh_token?: string; scope?: string }

const toTokens = (t: TokenResponse, now = Date.now()): OAuthTokens => ({
  accessToken: t.access_token, ...(t.refresh_token ? { refreshToken: t.refresh_token } : {}),
  expiresAt: new Date(now + t.expires_in * 1000), scopes: (t.scope ?? "").split(/\s+/).filter(Boolean),
});

export function createXAuth(cfg: { clientId: string; clientSecret: string }, f: typeof fetch = fetch): Pick<SocialAdapter, "oauth" | "fetchAccount"> {
  const basic = `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`; // confidential client
  const tokenRequest = async (params: Record<string, string>) => {
    const res = await platformFetch(f, "x", TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: basic }, body: new URLSearchParams({ ...params, client_id: cfg.clientId }) });
    const body = (await res.json()) as TokenResponse;
    if (!body.access_token) throw new PlatformError("permanent", "x token response missing access_token");
    return toTokens(body);
  };
  return {
    oauth: {
      usesPkce: true,
      authorizationUrl: ({ state, redirectUri, codeChallenge }) =>
        `${AUTH_URL}?${new URLSearchParams({ response_type: "code", client_id: cfg.clientId, redirect_uri: redirectUri, scope: X_SCOPES.join(" "), state, code_challenge: codeChallenge ?? "", code_challenge_method: "S256" })}`,
      exchangeCode: ({ code, redirectUri, codeVerifier }) => tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: codeVerifier ?? "" }),
      refresh: (refreshToken) => tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }),
    },
    async fetchAccount(accessToken) {
      const res = await platformFetch(f, "x", "https://api.x.com/2/users/me?user.fields=profile_image_url", { headers: { Authorization: `Bearer ${accessToken}` } });
      const u = ((await res.json()) as { data?: { id: string; name?: string; username?: string; profile_image_url?: string } }).data;
      if (!u?.id) throw new PlatformError("permanent", "x users/me returned no user");
      return { externalId: u.id, displayName: u.name ?? u.username ?? "X account", ...(u.username ? { username: u.username } : {}), ...(u.profile_image_url ? { avatarUrl: u.profile_image_url } : {}), accountType: "personal", metadata: { ...(u.username ? { username: u.username } : {}) } };
    },
  };
}
