import { PlatformError, platformFetch } from "../core/errors.js";
import type { MetricsResult, RawMetric, SocialAdapter } from "../core/types.js";

// Verified (docs.x.com metrics): public_metrics = retweet_count, quote_count, like_count, reply_count, impression_count, bookmark_count (any auth).
// Non-public/organic metrics (clicks, profile clicks, engagements) need user-context auth and are intentionally not requested.
const API = "https://api.x.com/2";
const POST_FIELDS = ["impression_count", "like_count", "reply_count", "retweet_count", "quote_count", "bookmark_count"];
const ACCOUNT_FIELDS = ["followers_count"];

const pick = (obj: Record<string, unknown> | undefined, prefix: string, fields: string[]): RawMetric[] =>
  fields.map((f) => {
    const v = obj?.[f];
    return typeof v === "number" ? { originalName: `${prefix}.${f}`, value: v, availability: "available" } : { originalName: `${prefix}.${f}`, value: null, availability: "unavailable" };
  });

export function createXAnalytics(f: typeof fetch = fetch): Pick<SocialAdapter, "fetchPostMetrics" | "fetchAccountMetrics"> {
  return {
    async fetchPostMetrics({ accessToken, externalPostId }): Promise<MetricsResult> {
      const source = `${API}/tweets/${externalPostId}?tweet.fields=public_metrics`;
      const res = await platformFetch(f, "x", source, { headers: { Authorization: `Bearer ${accessToken}` } });
      const body = (await res.json()) as { data?: { public_metrics?: Record<string, unknown> }; errors?: unknown };
      if (!body.data) throw new PlatformError("permanent", "x returned no data for this post (deleted or not visible)");
      const metrics = pick(body.data.public_metrics, "public_metrics", POST_FIELDS);
      // Verified (docs.x.com): non_public_metrics (url_link_clicks, user_profile_clicks) work with OAuth 2.0 user context for posts you own, for
      // a limited time after posting. Requested separately so an expired/forbidden window leaves them UNAVAILABLE without failing the collection.
      let nonPublic: Record<string, unknown> | undefined, np: unknown;
      try {
        const r = await f(`${API}/tweets/${externalPostId}?tweet.fields=non_public_metrics`, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (r.ok) { np = await r.json(); nonPublic = (np as { data?: { non_public_metrics?: Record<string, unknown> } }).data?.non_public_metrics; }
      } catch { /* unavailable */ }
      return { metrics: [...metrics, ...pick(nonPublic, "non_public_metrics", ["url_link_clicks", "user_profile_clicks"])], raw: { public: body, nonPublic: np ?? null }, source };
    },
    async fetchAccountMetrics({ accessToken }): Promise<MetricsResult> {
      const source = `${API}/users/me?user.fields=public_metrics`;
      const res = await platformFetch(f, "x", source, { headers: { Authorization: `Bearer ${accessToken}` } });
      const body = (await res.json()) as { data?: { public_metrics?: Record<string, unknown> } };
      return { metrics: pick(body.data?.public_metrics, "public_metrics", ACCOUNT_FIELDS), raw: body, source };
    },
  };
}
