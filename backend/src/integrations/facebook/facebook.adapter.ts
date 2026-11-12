import { PlatformError } from "../core/errors.js";
import { metaFetch } from "../core/http.js";
import { withHashtags } from "../core/rules.js";
import { NO_CAPABILITIES, type ConnectedAccount, type RawMetric, type SocialAdapter } from "../core/types.js";

// Verified (developers.facebook.com Pages API, Graph API v27.0): GET /{user}/accounts lists Pages the person can act on, each with a Page
// access token; POST /{page}/feed {message}; POST /{page}/photos {url, published}; multi-photo = photos with published=false then
// /feed with attached_media[n]={"media_fbid"}; POST /{page}/videos {file_url, description}. Permissions: pages_manage_posts,
// pages_read_engagement, pages_show_list (+ publish_video for video). Needs Meta App Review for non-role users.
// Insights (Graph reference "Page/insights", v27.0; deprecated-metrics page): GET /{id}/insights?metric=a,b[&period=] with a Page token (needs read_insights +
// pages_read_engagement; ANALYZE task) -> {data:[{name, period, values:[{value, end_time}]}]}. Impression metrics died 2025-06-15 / 2025-11-15 (all versions);
// replacements used: post_media_view, post_total_media_view_unique, post_clicks, post_reactions_by_type_total (lifetime), page_follows, page_media_view (day).
// The value envelope is the standard Insights shape (Meta's reference page does not spell it out); comments/shares come from the post edge itself.
// Meta announced another batch of Page metric deprecations for 2026-06-15: an invalid metric surfaces as a failed collection, not as zeros.
// Not verified here (so not claimed): long-lived/never-expiring Page token mechanics beyond the standard fb_exchange_token flow.
const V = "v27.0";
const GRAPH = `https://graph.facebook.com/${V}`;
export const FACEBOOK_SCOPES = ["pages_show_list", "pages_manage_posts", "pages_read_engagement", "read_insights", "publish_video"];

const POST_METRICS = ["post_media_view", "post_total_media_view_unique", "post_clicks", "post_reactions_by_type_total"];
const num = (originalName: string, v: unknown): RawMetric => typeof v === "number" ? { originalName, value: v, availability: "available" } : { originalName, value: null, availability: "unavailable" };

export function createFacebookAdapter(cfg: { clientId: string; clientSecret: string }, f: typeof fetch = fetch): SocialAdapter {
  const auth = (t: string) => ({ authorization: `Bearer ${t}` });
  /** name -> latest value; an object value (reactions by type) is summed. */
  async function insights(token: string, url: string): Promise<Record<string, number | undefined>> {
    const r = await metaFetch(f, "facebook", url, { headers: auth(token) });
    const out: Record<string, number | undefined> = {};
    for (const d of ((await r.json()) as { data?: { name: string; values?: { value?: unknown }[] }[] }).data ?? []) {
      const v = d.values?.at(-1)?.value;
      out[d.name] = typeof v === "number" ? v : v && typeof v === "object" ? Object.values(v as Record<string, unknown>).reduce<number>((s, x) => s + (typeof x === "number" ? x : 0), 0) : undefined;
    }
    return out;
  }
  return {
    platform: "facebook",
    capabilities: { ...NO_CAPABILITIES, textPost: true, imagePost: true, videoPost: true, lookupRecentPosts: true, postAnalytics: true, accountAnalytics: true },
    oauth: {
      usesPkce: false,
      authorizationUrl: ({ state, redirectUri }) => `https://www.facebook.com/${V}/dialog/oauth?${new URLSearchParams({ client_id: cfg.clientId, redirect_uri: redirectUri, scope: FACEBOOK_SCOPES.join(","), response_type: "code", state })}`,
      async exchangeCode({ code, redirectUri }) {
        const s = await metaFetch(f, "facebook", `${GRAPH}/oauth/access_token?${new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: redirectUri, code })}`);
        const short = ((await s.json()) as { access_token?: string }).access_token;
        if (!short) throw new PlatformError("permanent", "facebook token response missing access_token");
        const l = await metaFetch(f, "facebook", `${GRAPH}/oauth/access_token?${new URLSearchParams({ grant_type: "fb_exchange_token", client_id: cfg.clientId, client_secret: cfg.clientSecret, fb_exchange_token: short })}`);
        const long = (await l.json()) as { access_token?: string; expires_in?: number };
        if (!long.access_token) throw new PlatformError("permanent", "facebook long-lived exchange failed");
        return { accessToken: long.access_token, scopes: FACEBOOK_SCOPES }; // the user token is only used to list Pages; Page tokens are what get stored
      },
    },
    async fetchAccount(): Promise<never> { throw new PlatformError("permanent", "facebook connects Pages through listAccounts"); },
    async listAccounts(tokens): Promise<ConnectedAccount[]> {
      const r = await metaFetch(f, "facebook", `${GRAPH}/me/accounts?${new URLSearchParams({ fields: "id,name,username,access_token,picture{url}", limit: "100" })}`, { headers: auth(tokens.accessToken) });
      const pages = ((await r.json()) as { data?: { id: string; name: string; username?: string; access_token?: string; picture?: { data?: { url?: string } } }[] }).data ?? [];
      return pages.filter((p) => p.access_token).map((p) => ({
        profile: { externalId: p.id, displayName: p.name, ...(p.username ? { username: p.username } : {}), ...(p.picture?.data?.url ? { avatarUrl: p.picture.data.url } : {}), accountType: "business" as const, metadata: {} },
        tokens: { accessToken: p.access_token!, scopes: tokens.scopes },
      }));
    },
    async publish({ accessToken, account, content, media, signal }) {
      const page = account.externalId;
      const items = media.filter((m) => m.role === "media");
      const message = withHashtags(content);
      const post = async (path: string, body: Record<string, string>, creates: boolean) => {
        const r = await metaFetch(f, "facebook", `${GRAPH}/${path}`, { method: "POST", headers: auth(accessToken), body: new URLSearchParams(body), signal }, { creates });
        return (await r.json()) as { id?: string; post_id?: string };
      };
      let id: string | undefined;
      const videos = items.filter((m) => m.kind === "video"), images = items.filter((m) => m.kind === "image");
      if (videos.length) {
        if (videos.length > 1 || images.length) throw new PlatformError("permanent", "A post carries one video or photos, not both");
        id = (await post(`${page}/videos`, { file_url: await videos[0]!.url(), ...(message ? { description: message } : {}) }, true)).id;
      } else if (images.length === 1) {
        const r = await post(`${page}/photos`, { url: await images[0]!.url(), published: "true", ...(message ? { caption: message } : {}) }, true);
        id = r.post_id ?? r.id;
      } else if (images.length > 1) {
        const ids: string[] = []; // unpublished photo uploads are invisible (deleted after ~24 h) so safe to retry
        for (const m of images) { const u = (await post(`${page}/photos`, { url: await m.url(), published: "false" }, false)).id; if (!u) throw new PlatformError("permanent", "facebook returned no photo id"); ids.push(u); }
        id = (await post(`${page}/feed`, { ...(message ? { message } : {}), ...Object.fromEntries(ids.map((p, i) => [`attached_media[${i}]`, JSON.stringify({ media_fbid: p })])) }, true)).id;
      } else id = (await post(`${page}/feed`, { message }, true)).id;
      if (!id) throw new PlatformError("unknown", "facebook accepted the publish but returned no id");
      return { externalId: id, url: `https://www.facebook.com/${id}`, raw: { id } };
    },
    async fetchPostMetrics({ accessToken, externalPostId }) {
      const id = encodeURIComponent(externalPostId);
      const ins = await insights(accessToken, `${GRAPH}/${id}/insights?${new URLSearchParams({ metric: POST_METRICS.join(",") })}`);
      const edge = await metaFetch(f, "facebook", `${GRAPH}/${id}?${new URLSearchParams({ fields: "shares,comments.summary(true).limit(0)" })}`, { headers: auth(accessToken) });
      const e = (await edge.json()) as { shares?: { count?: number }; comments?: { summary?: { total_count?: number } } };
      // Facebook omits `shares` when a post has none, so a missing field is unavailable (never 0).
      const metrics = [...POST_METRICS.map((n) => num(n, ins[n])), num("shares", e.shares?.count), num("comments", e.comments?.summary?.total_count)];
      return { source: "post insights + post edge", raw: { insights: ins, edge: e }, metrics };
    },
    async fetchAccountMetrics({ accessToken, account }) {
      const ins = await insights(accessToken, `${GRAPH}/${account.externalId}/insights?${new URLSearchParams({ metric: "page_follows,page_media_view", period: "day" })}`);
      return { source: "page insights", raw: ins, metrics: [num("page_follows", ins.page_follows), { ...num("page_media_view", ins.page_media_view), period: "day" as const }] };
    },
    async reconcile({ accessToken, account, content, since }) {
      const r = await metaFetch(f, "facebook", `${GRAPH}/${account.externalId}/posts?fields=id,message,created_time,permalink_url&limit=10`, { headers: auth(accessToken) });
      const want = withHashtags(content).trim();
      const hit = ((await r.json()) as { data?: { id: string; message?: string; created_time?: string; permalink_url?: string }[] }).data?.find((p) => (p.message ?? "").trim() === want && (!p.created_time || new Date(p.created_time) >= since));
      return hit ? { externalId: hit.id, ...(hit.permalink_url ? { url: hit.permalink_url } : {}) } : null;
    },
  };
}
