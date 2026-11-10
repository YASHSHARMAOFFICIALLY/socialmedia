import type { OAuthTokens, SocialAdapter } from "../core/types.js";
import { PlatformError, platformFetch } from "../core/errors.js";
import type { LinkedInTokenResponse, LinkedInUserInfo } from "./linkedin.types.js";

// Verified (LinkedIn authorization-code flow docs): authorize/token endpoints, OIDC userinfo, ~60-day access tokens.
// Refresh tokens are only issued to approved partner apps, so tokenRefresh stays false and expiry => re-authorize.
const AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const USERINFO_URL = "https://api.linkedin.com/v2/userinfo";
export const LINKEDIN_SCOPES = ["openid", "profile", "email", "w_member_social"];

function toTokens(t: LinkedInTokenResponse, now = Date.now()): OAuthTokens {
  return {
    accessToken: t.access_token,
    ...(t.refresh_token ? { refreshToken: t.refresh_token } : {}),
    expiresAt: new Date(now + t.expires_in * 1000),
    ...(t.refresh_token_expires_in ? { refreshExpiresAt: new Date(now + t.refresh_token_expires_in * 1000) } : {}),
    scopes: (t.scope ?? "").split(/[,\s]+/).filter(Boolean),
  };
}

export function createLinkedInAuth(cfg: { clientId: string; clientSecret: string }, f: typeof fetch = fetch): Pick<SocialAdapter, "oauth" | "fetchAccount"> {
  const tokenRequest = async (params: Record<string, string>) => {
    const res = await platformFetch(f, "linkedin", TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...params, client_id: cfg.clientId, client_secret: cfg.clientSecret }),
    });
    const body = (await res.json()) as LinkedInTokenResponse;
    if (!body.access_token) throw new PlatformError("permanent", "linkedin token response missing access_token");
    return toTokens(body);
  };
  return {
    oauth: {
      usesPkce: false,
      authorizationUrl: ({ state, redirectUri }) =>
        `${AUTH_URL}?${new URLSearchParams({ response_type: "code", client_id: cfg.clientId, redirect_uri: redirectUri, state, scope: LINKEDIN_SCOPES.join(" ") })}`,
      exchangeCode: ({ code, redirectUri }) => tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
      refresh: (refreshToken) => tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }),
    },
    async fetchAccount(accessToken) {
      const res = await platformFetch(f, "linkedin", USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
      const u = (await res.json()) as LinkedInUserInfo;
      if (!u.sub) throw new PlatformError("permanent", "linkedin userinfo missing sub");
      return {
        externalId: u.sub,
        displayName: u.name ?? ([u.given_name, u.family_name].filter(Boolean).join(" ") || "LinkedIn member"),
        ...(u.picture ? { avatarUrl: u.picture } : {}),
        accountType: "personal",
        metadata: { urn: `urn:li:person:${u.sub}`, ...(u.email ? { email: u.email } : {}) },
      };
    },
  };
}
