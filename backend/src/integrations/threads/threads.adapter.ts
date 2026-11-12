import { PlatformError } from "../core/errors.js";
import { metaFetch } from "../core/http.js";
import { withHashtags } from "../core/rules.js";
import { NO_CAPABILITIES, type MetricsResult, type OAuthTokens, type RawMetric, type SocialAdapter } from "../core/types.js";

// Verified (developers.facebook.com/docs/threads): authorize https://threads.com/oauth/authorize (client_id, redirect_uri, scope, response_type=code, state);
// code -> short-lived: POST https://graph.threads.com/oauth/access_token (form; client_id, client_secret, code, grant_type=authorization_code, redirect_uri);
// short -> long-lived (60 d): GET https://graph.threads.com/access_token?grant_type=th_exchange_token&client_secret&access_token;
// refresh: GET https://graph.threads.com/refresh_access_token?grant_type=th_refresh_token&access_token (valid token only).
// Publish: POST /v1.0/{user}/threads (media_type TEXT|IMAGE|VIDEO, text, image_url|video_url, is_carousel_item) -> container;
// carousel container (media_type CAROUSEL, children) ; POST /{user}/threads_publish {creation_id}; GET /{container}?fields=status.
// Insights: GET /{media}/insights?metric=views,likes,replies,reposts,quotes,shares ; GET /{user}/threads_insights?metric=followers_count.
// Container status values IN_PROGRESS|FINISHED|ERROR|EXPIRED are the Meta container convention (value list not shown on the Threads pages read).
const AUTH_URL = "https://threads.com/oauth/authorize";
const GRAPH = "https://graph.threads.com";
const API = `${GRAPH}/v1.0`;
export const THREADS_SCOPES = ["threads_basic", "threads_content_publish", "threads_manage_insights"];
export const POST_METRICS = ["views", "likes", "replies", "reposts", "quotes", "shares"];

interface Long { access_token: string; expires_in: number }

export function createThreadsAdapter(cfg: { clientId: string; clientSecret: string; pollMs?: number; maxPolls?: number }, f: typeof fetch = fetch): SocialAdapter {
  const auth = (t: string) => ({ authorization: `Bearer ${t}` });
  const toTokens = (t: Long, scopes: string[]): OAuthTokens => ({ accessToken: t.access_token, refreshToken: t.access_token, expiresAt: new Date(Date.now() + t.expires_in * 1000), scopes });

  return {
    platform: "threads",
    // Posting for non-tester users needs Meta app review (advanced access for threads_content_publish).
    capabilities: { ...NO_CAPABILITIES, textPost: true, imagePost: true, videoPost: true, carousel: true, tokenRefresh: true, lookupRecentPosts: true, postAnalytics: true, accountAnalytics: true, engagementMetrics: true },
    oauth: {
      usesPkce: false,
      authorizationUrl: ({ state, redirectUri }) => `${AUTH_URL}?${new URLSearchParams({ client_id: cfg.clientId, redirect_uri: redirectUri, scope: THREADS_SCOPES.join(","), response_type: "code", state })}`,
      async exchangeCode({ code, redirectUri }) {
        const s = await metaFetch(f, "threads", `${GRAPH}/oauth/access_token`, { method: "POST", body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code, grant_type: "authorization_code", redirect_uri: redirectUri }) });
        const short = (await s.json()) as { access_token?: string };
        if (!short.access_token) throw new PlatformError("permanent", "threads token response missing access_token");
        const l = await metaFetch(f, "threads", `${GRAPH}/access_token?${new URLSearchParams({ grant_type: "th_exchange_token", client_secret: cfg.clientSecret, access_token: short.access_token })}`);
        const long = (await l.json()) as Long;
        if (!long.access_token) throw new PlatformError("permanent", "threads long-lived token exchange failed");
        return toTokens(long, THREADS_SCOPES);
      },
      async refresh(current) {
        const r = await metaFetch(f, "threads", `${GRAPH}/refresh_access_token?${new URLSearchParams({ grant_type: "th_refresh_token", access_token: current })}`);
        const t = (await r.json()) as Long;
        if (!t.access_token) throw new PlatformError("permanent", "threads refresh failed");
        return toTokens(t, []);
      },
    },
    async fetchAccount(accessToken) {
      const r = await metaFetch(f, "threads", `${API}/me?fields=id,username,name,threads_profile_picture_url`, { headers: auth(accessToken) });
      const u = (await r.json()) as { id?: string; username?: string; name?: string; threads_profile_picture_url?: string };
      if (!u.id) throw new PlatformError("permanent", "threads /me returned no user id");
      return { externalId: u.id, displayName: u.name ?? u.username ?? "Threads account", ...(u.username ? { username: u.username } : {}), ...(u.threads_profile_picture_url ? { avatarUrl: u.threads_profile_picture_url } : {}), accountType: "personal", metadata: {} };
    },
    async publish({ accessToken, account, content, media, signal }) {
      const user = account.externalId;
      const items = media.filter((m) => m.role === "media");
      const text = withHashtags(content);
      const post = async (path: string, body: Record<string, string>, creates = false) => {
        const r = await metaFetch(f, "threads", `${API}/${path}`, { method: "POST", headers: auth(accessToken), body: new URLSearchParams(body), signal }, { creates });
        return (await r.json()) as { id?: string };
      };
      const container = async (body: Record<string, string>) => {
        const id = (await post(`${user}/threads`, body)).id;
        if (!id) throw new PlatformError("permanent", "threads returned no container id");
        return id;
      };
      const itemBody = async (m: (typeof items)[number]): Promise<Record<string, string>> => (m.kind === "image" ? { media_type: "IMAGE", image_url: await m.url() } : { media_type: "VIDEO", video_url: await m.url() });
      const waitFinished = async (id: string) => {
        for (let n = 0; n < (cfg.maxPolls ?? 30); n++) {
          const r = await metaFetch(f, "threads", `${API}/${id}?fields=status,error_message`, { headers: auth(accessToken), signal });
          const s = ((await r.json()) as { status?: string }).status;
          if (s === "FINISHED") return;
          if (s === "ERROR" || s === "EXPIRED") throw new PlatformError("permanent", `threads container ${s}`);
          await new Promise((res) => setTimeout(res, cfg.pollMs ?? 3000));
        }
        throw new PlatformError("retryable", "threads is still processing the media");
      };

      // Containers are invisible until threads_publish, so everything before it is safely retryable.
      let creationId: string;
      if (items.length === 0) creationId = await container({ media_type: "TEXT", text });
      else if (items.length === 1) creationId = await container({ ...(await itemBody(items[0]!)), ...(text ? { text } : {}) });
      else {
        if (items.length < 2) throw new PlatformError("permanent", "A carousel needs at least 2 items");
        const children: string[] = [];
        for (const m of items) { const id = await container({ ...(await itemBody(m)), is_carousel_item: "true" }); await waitFinished(id); children.push(id); }
        creationId = await container({ media_type: "CAROUSEL", children: children.join(","), ...(text ? { text } : {}) });
      }
      await waitFinished(creationId);
      const published = await post(`${user}/threads_publish`, { creation_id: creationId }, true);
      if (!published.id) throw new PlatformError("unknown", "threads accepted the publish but returned no media id");
      let url: string | undefined;
      try { // the permalink is a nicety: never fail a successful publish over it
        const r = await f(`${API}/${published.id}?fields=permalink`, { headers: auth(accessToken), signal });
        url = r.ok ? ((await r.json()) as { permalink?: string }).permalink : undefined;
      } catch { /* ignore */ }
      return { externalId: published.id, ...(url ? { url } : {}), raw: { id: published.id } };
    },
    async reconcile({ accessToken, account, content, since }) {
      const r = await metaFetch(f, "threads", `${API}/${account.externalId}/threads?fields=id,text,timestamp,permalink&limit=10`, { headers: auth(accessToken) });
      const want = withHashtags(content).trim();
      const hit = ((await r.json()) as { data?: { id: string; text?: string; timestamp?: string; permalink?: string }[] }).data?.find((p) => (p.text ?? "").trim() === want && (!p.timestamp || new Date(p.timestamp) >= since));
      return hit ? { externalId: hit.id, ...(hit.permalink ? { url: hit.permalink } : {}) } : null;
    },
    async fetchPostMetrics({ accessToken, externalPostId }): Promise<MetricsResult> {
      const source = `${API}/${externalPostId}/insights?metric=${POST_METRICS.join(",")}`;
      const r = await metaFetch(f, "threads", source, { headers: auth(accessToken) });
      const raw = (await r.json()) as { data?: { name: string; values?: { value?: number }[] }[] };
      const by = new Map(raw.data?.map((m) => [m.name, m.values?.[0]?.value] as const));
      return { source, raw, metrics: POST_METRICS.map((n): RawMetric => (typeof by.get(n) === "number" ? { originalName: n, value: by.get(n)!, availability: "available" } : { originalName: n, value: null, availability: "unavailable" })) };
    },
    async fetchAccountMetrics({ accessToken, account }): Promise<MetricsResult> {
      const source = `${API}/${account.externalId}/threads_insights?metric=followers_count`;
      const r = await metaFetch(f, "threads", source, { headers: auth(accessToken) });
      const raw = (await r.json()) as { data?: { name: string; total_value?: { value?: number }; values?: { value?: number }[] }[] };
      const m = raw.data?.find((d) => d.name === "followers_count");
      const v = m?.total_value?.value ?? m?.values?.[0]?.value;
      return { source, raw, metrics: [typeof v === "number" ? { originalName: "followers_count", value: v, availability: "available" } : { originalName: "followers_count", value: null, availability: "unavailable" }] };
    },
  };
}
