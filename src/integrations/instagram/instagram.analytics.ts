import { errorFromResponse, platformFetch } from "../core/errors.js";
import type { MetricsResult, RawMetric, SocialAdapter } from "../core/types.js";
import { GRAPH } from "./instagram.auth.js";

// Verified (Instagram Platform insights docs, IG Media insights reference): GET /<MEDIA_ID>/insights?metric=... with permission
// instagram_business_manage_insights; media metrics comments, likes, views, reach, saved, shares, reposts, profile_visits, ig_reels_avg_watch_time.
// `impressions` is deprecated for media created after 2024-07-02 and is not requested. Data may lag up to 48 h.
// "If insights data does not exist or is unavailable the API returns an EMPTY data set instead of 0": absent metric => `unavailable`.
// Account followers: GET /me?fields=followers_count.
export const POST_METRICS = ["views", "reach", "likes", "comments", "saved", "shares", "reposts", "profile_visits", "ig_reels_avg_watch_time"];

export function createInstagramAnalytics(f: typeof fetch = fetch): Pick<SocialAdapter, "fetchPostMetrics" | "fetchAccountMetrics"> {
  const headers = (t: string) => ({ Authorization: `Bearer ${t}` });
  return {
    async fetchPostMetrics({ accessToken, externalPostId }): Promise<MetricsResult> {
      const source = `${GRAPH}/${externalPostId}/insights?metric=${POST_METRICS.join(",")}`;
      // Not every metric applies to every media type; an unsupported metric fails the WHOLE request, so retry one by one.
      let res = await f(source, { headers: headers(accessToken) });
      let byName = new Map<string, number>(), raw: unknown;
      if (res.ok) {
        raw = await res.json();
        for (const m of ((raw as { data?: { name: string; values?: { value?: number }[] }[] }).data ?? [])) { const v = m.values?.[0]?.value; if (typeof v === "number") byName.set(m.name, v); }
      } else if (res.status === 400) {
        const parts: unknown[] = [];
        for (const name of POST_METRICS) {
          const one = await f(`${GRAPH}/${externalPostId}/insights?metric=${name}`, { headers: headers(accessToken) });
          if (one.status === 401 || one.status === 429 || one.status >= 500) throw errorFromResponse("instagram", one);
          if (!one.ok) continue;
          const j = (await one.json()) as { data?: { name: string; values?: { value?: number }[] }[] };
          parts.push(j);
          for (const m of j.data ?? []) { const v = m.values?.[0]?.value; if (typeof v === "number") byName.set(m.name, v); }
        }
        raw = { fallback: "per-metric requests", parts };
      } else {
        throw errorFromResponse("instagram", res);
      }
      const metrics: RawMetric[] = POST_METRICS.map((n) => (byName.has(n) ? { originalName: n, value: byName.get(n)!, availability: "available" } : { originalName: n, value: null, availability: "unavailable" }));
      return { metrics, raw, source };
    },
    async fetchAccountMetrics({ accessToken }): Promise<MetricsResult> {
      const source = `${GRAPH}/me?fields=followers_count`;
      const res = await platformFetch(f, "instagram", source, { headers: headers(accessToken) });
      const body = (await res.json()) as { followers_count?: number; data?: { followers_count?: number }[] };
      const v = body.followers_count ?? body.data?.[0]?.followers_count;
      return { metrics: [typeof v === "number" ? { originalName: "followers_count", value: v, availability: "available" } : { originalName: "followers_count", value: null, availability: "unavailable" }], raw: body, source };
    },
  };
}
