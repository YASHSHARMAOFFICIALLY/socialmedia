import { PlatformError } from "../core/errors.js";
import { apiFetch } from "../core/http.js";
import { withHashtags } from "../core/rules.js";
import { NO_CAPABILITIES, type OAuthTokens, type SocialAdapter } from "../core/types.js";

// SOURCE CAVEAT: developers.tiktok.com is JavaScript-rendered and could not be fetched in this build. Endpoint URLs below were confirmed
// from TikTok's own page titles/URLs via search (/v2/post/publish/video/init/, /v2/post/publish/status/fetch/, source=PULL_FROM_URL);
// the token endpoint, field names and response shapes come from third-party guides and MUST be checked against first-party docs
// (and with `npm run test:live`) before relying on this adapter. Unaudited TikTok apps can only post privately.
// PULL_FROM_URL requires the media URL's domain/prefix to be verified in the TikTok developer portal (so R2 needs a custom domain).
const API = "https://open.tiktokapis.com";
export const TIKTOK_SCOPES = ["user.info.basic", "video.publish"];

export function createTikTokAdapter(cfg: { clientKey: string; clientSecret: string; pollMs?: number; maxPolls?: number }, f: typeof fetch = fetch): SocialAdapter {
  const auth = (t: string) => ({ authorization: `Bearer ${t}`, "content-type": "application/json; charset=UTF-8" });
  async function token(body: Record<string, string>): Promise<OAuthTokens> {
    const r = await apiFetch(f, "tiktok", `${API}/v2/oauth/token/`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_key: cfg.clientKey, client_secret: cfg.clientSecret, ...body }) });
    const t = (await r.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; refresh_expires_in?: number; scope?: string };
    if (!t.access_token) throw new PlatformError("permanent", "tiktok token response missing access_token");
    const now = Date.now();
    return { accessToken: t.access_token, ...(t.refresh_token ? { refreshToken: t.refresh_token } : {}), ...(t.expires_in ? { expiresAt: new Date(now + t.expires_in * 1000) } : {}), ...(t.refresh_expires_in ? { refreshExpiresAt: new Date(now + t.refresh_expires_in * 1000) } : {}), scopes: (t.scope ?? "").split(",").filter(Boolean) };
  }
  const data = async <T>(r: Response): Promise<T> => {
    const j = (await r.json()) as { data?: T; error?: { code?: string; message?: string } };
    if (j.error?.code && j.error.code !== "ok") throw new PlatformError(/token/i.test(j.error.code) ? "auth_expired" : "permanent", `tiktok error ${j.error.code}`);
    return j.data as T;
  };

  return {
    platform: "tiktok",
    capabilities: { ...NO_CAPABILITIES, videoPost: true, tokenRefresh: true },
    oauth: {
      usesPkce: false,
      authorizationUrl: ({ state, redirectUri }) => `https://www.tiktok.com/v2/auth/authorize/?${new URLSearchParams({ client_key: cfg.clientKey, scope: TIKTOK_SCOPES.join(","), response_type: "code", redirect_uri: redirectUri, state })}`,
      exchangeCode: ({ code, redirectUri }) => token({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
      refresh: (refreshToken) => token({ grant_type: "refresh_token", refresh_token: refreshToken }),
    },
    async fetchAccount(accessToken) {
      const r = await apiFetch(f, "tiktok", `${API}/v2/user/info/?fields=open_id,display_name,avatar_url`, { headers: auth(accessToken) });
      const u = (await data<{ user?: { open_id?: string; display_name?: string; avatar_url?: string } }>(r)).user;
      if (!u?.open_id) throw new PlatformError("permanent", "tiktok user info returned no open_id");
      return { externalId: u.open_id, displayName: u.display_name ?? "TikTok account", ...(u.avatar_url ? { avatarUrl: u.avatar_url } : {}), accountType: "personal", metadata: {} };
    },
    async publish({ accessToken, content, media, signal }) {
      const video = media.find((m) => m.role === "media");
      if (!video || video.kind !== "video") throw new PlatformError("permanent", "TikTok posts here need one video");
      const privacy = String(content.metadata.privacy ?? "");
      const info = await data<{ privacy_level_options?: string[] }>(await apiFetch(f, "tiktok", `${API}/v2/post/publish/creator_info/query/`, { method: "POST", headers: auth(accessToken), signal }));
      if (!info?.privacy_level_options?.includes(privacy)) throw new PlatformError("permanent", `privacy '${privacy}' is not allowed for this creator (allowed: ${(info?.privacy_level_options ?? []).join(", ") || "none"})`);
      const init = await data<{ publish_id?: string }>(await apiFetch(f, "tiktok", `${API}/v2/post/publish/video/init/`, {
        method: "POST", headers: auth(accessToken), signal,
        body: JSON.stringify({ post_info: { title: withHashtags(content), privacy_level: privacy }, source_info: { source: "PULL_FROM_URL", video_url: await video.url() } }),
      }, { creates: true }));
      if (!init?.publish_id) throw new PlatformError("unknown", "tiktok accepted the publish but returned no publish_id");
      // Processing is asynchronous: poll briefly; a post still processing is accepted (the publish_id is its identity).
      for (let n = 0; n < (cfg.maxPolls ?? 10); n++) {
        const s = await data<{ status?: string; fail_reason?: string; publicaly_available_post_id?: (string | number)[] }>(await apiFetch(f, "tiktok", `${API}/v2/post/publish/status/fetch/`, { method: "POST", headers: auth(accessToken), body: JSON.stringify({ publish_id: init.publish_id }), signal }));
        if (s?.status === "PUBLISH_COMPLETE") return { externalId: String(s.publicaly_available_post_id?.[0] ?? init.publish_id), raw: s };
        if (s?.status === "FAILED") throw new PlatformError("permanent", `tiktok publish failed${s.fail_reason ? `: ${s.fail_reason}` : ""}`);
        await new Promise((res) => setTimeout(res, cfg.pollMs ?? 3000));
      }
      return { externalId: init.publish_id, warnings: ["TikTok is still processing/moderating the video; externalId is the publish_id"], raw: init };
    },
  };
}
