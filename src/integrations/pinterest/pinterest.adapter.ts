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
// Video pins (UNVERIFIED end to end): POST /v5/media {media_type:"video"} -> {media_id, upload_url, upload_parameters} (generated client docs);
// upload = multipart POST to upload_url with every upload_parameter then the `file` part; GET /v5/media/{id} -> {status} (values registered|processing|succeeded|failed
// come from third-party guides only); then POST /v5/pins with media_source {source_type:"video_id", media_id, cover_image_url}. A community report says the
// cover is required in practice, so it is. The file is buffered in memory (ceiling: Workers memory; rules cap video size). Video pins are not available in the sandbox.
// Pin analytics: GET /v5/pins/{id}/analytics?start_date&end_date&metric_types (start <= 90 days ago, range <= 90 days; owner's token) -> an object keyed by
// app type (default "ALL") of {lifetime_metrics{name:int}, daily_metrics[], summary_metrics{name:float}} (generated client models). Metric names IMPRESSION,
// SAVE, PIN_CLICK, OUTBOUND_CLICK, VIDEO_MRC_VIEW come from API docs/connector docs; the exact keys inside lifetime_metrics are UNVERIFIED, so lifetime is
// preferred and the period summary is the fallback. Pins older than 2023-03-20 only have lifetime metrics for video pins.
// NOT claimed: reconcile (no lookup-by-content endpoint used).
const API = "https://api.pinterest.com/v5";
const PIN_METRICS = ["IMPRESSION", "SAVE", "PIN_CLICK", "OUTBOUND_CLICK"];
export const PINTEREST_SCOPES = ["boards:read", "pins:read", "pins:write", "user_accounts:read"];

export function createPinterestAdapter(cfg: { clientId: string; clientSecret: string; pollMs?: number }, f: typeof fetch = fetch): SocialAdapter {
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
  async function uploadVideo(accessToken: string, url: string, signal: AbortSignal): Promise<string> {
    const reg = await apiFetch(f, "pinterest", `${API}/media`, { method: "POST", headers: { ...auth(accessToken), "content-type": "application/json" }, body: JSON.stringify({ media_type: "video" }), signal });
    const m = (await reg.json()) as { media_id?: string; upload_url?: string; upload_parameters?: Record<string, string> };
    if (!m.media_id || !m.upload_url) throw new PlatformError("permanent", "pinterest media registration returned no upload target");
    const src = await f(url, { signal });
    if (!src.ok) throw new PlatformError("retryable", `Could not read media from storage (${src.status})`);
    const form = new FormData();
    for (const [k, v] of Object.entries(m.upload_parameters ?? {})) form.append(k, String(v));
    form.append("file", new Blob([await src.arrayBuffer()]), "video.mp4");
    const up = await f(m.upload_url, { method: "POST", body: form, signal });
    if (!up.ok) throw new PlatformError(up.status >= 500 ? "retryable" : "permanent", `pinterest video upload responded ${up.status}`, { status: up.status });
    for (let i = 0; i < 30; i++) {
      const r = await apiFetch(f, "pinterest", `${API}/media/${encodeURIComponent(m.media_id)}`, { headers: auth(accessToken), signal });
      const status = ((await r.json()) as { status?: string }).status?.toLowerCase();
      if (status === "succeeded") return m.media_id;
      if (status === "failed") throw new PlatformError("permanent", "pinterest could not process the video");
      await new Promise((ok) => setTimeout(ok, cfg.pollMs ?? 2000));
    }
    throw new PlatformError("retryable", "pinterest video is still processing"); // nothing is published yet, so a retry is safe
  }
  return {
    platform: "pinterest",
    capabilities: { ...NO_CAPABILITIES, imagePost: true, videoPost: true, tokenRefresh: true, postAnalytics: true, accountAnalytics: true },
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
      const main = media.find((m) => m.role === "media");
      if (!main) throw new PlatformError("permanent", "Pinterest pins need one image or video");
      const boardId = String(content.metadata.boardId ?? "");
      if (!/^\d+$/.test(boardId)) throw new PlatformError("permanent", "metadata.boardId is required");
      const description = withHashtags(content);
      let media_source: Record<string, string>;
      if (main.kind === "image") media_source = { source_type: "image_url", url: await main.url() };
      else {
        const cover = media.find((m) => m.role === "thumbnail");
        if (!cover) throw new PlatformError("permanent", "Pinterest video pins need a cover image (thumbnail)");
        media_source = { source_type: "video_id", media_id: await uploadVideo(accessToken, await main.url(), signal), cover_image_url: await cover.url() };
      }
      const r = await apiFetch(f, "pinterest", `${API}/pins`, {
        method: "POST", headers: { ...auth(accessToken), "content-type": "application/json" }, signal,
        body: JSON.stringify({ board_id: boardId, title: content.title ?? description.slice(0, 100), ...(description ? { description } : {}), ...(content.metadata.link ? { link: String(content.metadata.link) } : {}), ...(content.metadata.altText ? { alt_text: String(content.metadata.altText) } : {}), media_source }),
      }, { creates: true });
      const pin = (await r.json()) as { id?: string };
      if (!pin.id) throw new PlatformError("unknown", "pinterest accepted the pin but returned no id");
      return { externalId: pin.id, url: `https://www.pinterest.com/pin/${pin.id}/`, raw: pin };
    },
    async fetchPostMetrics({ accessToken, externalPostId, publishedAt }): Promise<MetricsResult> {
      const day = (d: Date) => d.toISOString().slice(0, 10);
      const today = new Date(), floor = new Date(today.getTime() - 89 * 86400_000);
      const source = `${API}/pins/${externalPostId}/analytics`;
      const r = await apiFetch(f, "pinterest", `${source}?${new URLSearchParams({ start_date: day(publishedAt > floor ? publishedAt : floor), end_date: day(today), metric_types: PIN_METRICS.join(",") })}`, { headers: auth(accessToken) });
      const raw = (await r.json()) as Record<string, { lifetime_metrics?: Record<string, number>; summary_metrics?: Record<string, number> }>;
      const all = raw.ALL ?? Object.values(raw)[0];
      return { source, raw, metrics: PIN_METRICS.map((n) => { const v = all?.lifetime_metrics?.[n] ?? all?.summary_metrics?.[n]; return typeof v === "number" ? { originalName: n, value: v, availability: "available" as const } : { originalName: n, value: null, availability: "unavailable" as const }; }) };
    },
    async fetchAccountMetrics({ accessToken }): Promise<MetricsResult> {
      const source = `${API}/user_account`;
      const r = await apiFetch(f, "pinterest", source, { headers: auth(accessToken) });
      const raw = (await r.json()) as { follower_count?: number };
      return { source, raw, metrics: [typeof raw.follower_count === "number" ? { originalName: "follower_count", value: raw.follower_count, availability: "available" } : { originalName: "follower_count", value: null, availability: "unavailable" }] };
    },
  };
}
