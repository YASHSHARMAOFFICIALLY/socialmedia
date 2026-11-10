import { PlatformError } from "../core/errors.js";
import { apiFetch } from "../core/http.js";
import { withHashtags } from "../core/rules.js";
import { NO_CAPABILITIES, type MetricsResult, type OAuthTokens, type SocialAdapter } from "../core/types.js";

// Verified (Pinterest API v5 OpenAPI spec): token endpoint POST https://api.pinterest.com/v5/oauth/token, HTTP Basic (client id:secret),
// form body grant_type=authorization_code|refresh_token (+ code, redirect_uri | refresh_token) -> {access_token, expires_in, refresh_token,
// refresh_token_expires_in, scope}; apps activated after 2025-09-25 get a continuous 60-day refresh token automatically;
// POST /v5/pins {board_id, title, description, link, alt_text, media_source:{source_type:"image_url", url}} ; GET /v5/user_account
// -> {username, profile_image, account_type, follower_count}. Authorize: https://www.pinterest.com/oauth/ .
// Trial access apps can only create pins visible to themselves until Pinterest upgrades them to Standard access.
// NOT claimed: pin analytics (response shape not confirmed), reconcile (no lookup-by-content endpoint used).
const API = "https://api.pinterest.com/v5";
export const PINTEREST_SCOPES = ["boards:read", "pins:read", "pins:write", "user_accounts:read"];

export function createPinterestAdapter(cfg: { clientId: string; clientSecret: string }, f: typeof fetch = fetch): SocialAdapter {
  const basic = `Basic ${btoa(`${cfg.clientId}:${cfg.clientSecret}`)}`;
  const auth = (t: string) => ({ authorization: `Bearer ${t}` });
  async function token(body: Record<string, string>): Promise<OAuthTokens> {
    const r = await apiFetch(f, "pinterest", `${API}/oauth/token`, { method: "POST", headers: { authorization: basic }, body: new URLSearchParams(body) });
    const t = (await r.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; refresh_token_expires_in?: number; scope?: string };
    if (!t.access_token) throw new PlatformError("permanent", "pinterest token response missing access_token");
    const now = Date.now();
    return {
      accessToken: t.access_token, ...(t.refresh_token ? { refreshToken: t.refresh_token } : {}),
      ...(t.expires_in ? { expiresAt: new Date(now + t.expires_in * 1000) } : {}), ...(t.refresh_token_expires_in ? { refreshExpiresAt: new Date(now + t.refresh_token_expires_in * 1000) } : {}),
      scopes: (t.scope ?? "").split(/[ ,]+/).filter(Boolean),
    };
  }
  return {
    platform: "pinterest",
    capabilities: { ...NO_CAPABILITIES, imagePost: true, tokenRefresh: true, accountAnalytics: true },
    oauth: {
      usesPkce: false,
      authorizationUrl: ({ state, redirectUri }) => `https://www.pinterest.com/oauth/?${new URLSearchParams({ client_id: cfg.clientId, redirect_uri: redirectUri, response_type: "code", scope: PINTEREST_SCOPES.join(","), state })}`,
      exchangeCode: ({ code, redirectUri }) => token({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
      refresh: (refreshToken) => token({ grant_type: "refresh_token", refresh_token: refreshToken }),
    },
    async fetchAccount(accessToken) {
      const r = await apiFetch(f, "pinterest", `${API}/user_account`, { headers: auth(accessToken) });
      const u = (await r.json()) as { username?: string; profile_image?: string; account_type?: string; business_name?: string };
      if (!u.username) throw new PlatformError("permanent", "pinterest user_account returned no username");
      return { externalId: u.username, displayName: u.business_name ?? u.username, username: u.username, ...(u.profile_image ? { avatarUrl: u.profile_image } : {}), accountType: u.account_type === "BUSINESS" ? "business" : "personal", metadata: {} };
    },
    async publish({ accessToken, content, media, signal }) {
      const image = media.find((m) => m.role === "media");
      if (!image || image.kind !== "image") throw new PlatformError("permanent", "Pinterest pins here need one image");
      const boardId = String(content.metadata.boardId ?? "");
      if (!/^\d+$/.test(boardId)) throw new PlatformError("permanent", "metadata.boardId is required");
      const description = withHashtags(content);
      const r = await apiFetch(f, "pinterest", `${API}/pins`, {
        method: "POST", headers: { ...auth(accessToken), "content-type": "application/json" }, signal,
        body: JSON.stringify({ board_id: boardId, title: content.title ?? description.slice(0, 100), ...(description ? { description } : {}), ...(content.metadata.link ? { link: String(content.metadata.link) } : {}), ...(content.metadata.altText ? { alt_text: String(content.metadata.altText) } : {}), media_source: { source_type: "image_url", url: await image.url() } }),
      }, { creates: true });
      const pin = (await r.json()) as { id?: string };
      if (!pin.id) throw new PlatformError("unknown", "pinterest accepted the pin but returned no id");
      return { externalId: pin.id, url: `https://www.pinterest.com/pin/${pin.id}/`, raw: pin };
    },
    async fetchAccountMetrics({ accessToken }): Promise<MetricsResult> {
      const source = `${API}/user_account`;
      const r = await apiFetch(f, "pinterest", source, { headers: auth(accessToken) });
      const raw = (await r.json()) as { follower_count?: number };
      return { source, raw, metrics: [typeof raw.follower_count === "number" ? { originalName: "follower_count", value: raw.follower_count, availability: "available" } : { originalName: "follower_count", value: null, availability: "unavailable" }] };
    },
  };
}
