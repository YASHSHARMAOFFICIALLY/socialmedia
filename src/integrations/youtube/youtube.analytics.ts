import { PlatformError } from "../core/errors.js";
import type { MetricsResult, RawMetric, SocialAdapter } from "../core/types.js";
import { toYouTubeError } from "./youtube.publisher.js";

// Verified (YouTube Data API videos/channels resources): videos.list part=statistics -> viewCount, likeCount, commentCount (strings);
// channels.list part=statistics -> subscriberCount (absent when hiddenSubscriberCount), viewCount, videoCount. list calls cost 1 quota unit.
// Not implemented: YouTube Analytics API (watch time, audience), which needs the yt-analytics.readonly scope.
const num = (v: unknown): number | null => (typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const metric = (name: string, v: unknown): RawMetric => { const n = num(v); return n === null ? { originalName: name, value: null, availability: "unavailable" } : { originalName: name, value: n, availability: "available" }; };

export function createYouTubeAnalytics(f: typeof fetch = fetch): Pick<SocialAdapter, "fetchPostMetrics" | "fetchAccountMetrics"> {
  return {
    async fetchPostMetrics({ accessToken, externalPostId, publishedAt }): Promise<MetricsResult> {
      const source = `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${encodeURIComponent(externalPostId)}`;
      const res = await f(source, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) throw await toYouTubeError(res, false);
      const body = (await res.json()) as { items?: { statistics?: Record<string, unknown> }[] };
      const st = body.items?.[0]?.statistics;
      if (!st) throw new PlatformError("permanent", "youtube returned no statistics for this video (deleted or private)");
      const metrics = ["viewCount", "likeCount", "commentCount"].map((k) => metric(`statistics.${k}`, st[k]));
      // YouTube Analytics API (scope yt-analytics.readonly): the metrics the Data API does not have. If the scope was not granted (connections made
      // before this was added) or the report is not ready, those metrics are reported UNAVAILABLE; the collection itself still succeeds.
      const extra = await reportMetrics(f, accessToken, externalPostId, publishedAt);
      return { metrics: [...metrics, ...extra.metrics], raw: { data: body, analytics: extra.raw }, source };
    },
    async fetchAccountMetrics({ accessToken }): Promise<MetricsResult> {
      const source = "https://www.googleapis.com/youtube/v3/channels?part=statistics&mine=true";
      const res = await f(source, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) throw await toYouTubeError(res, false);
      const body = (await res.json()) as { items?: { statistics?: Record<string, unknown> }[] };
      const st = body.items?.[0]?.statistics ?? {};
      return { metrics: [st.hiddenSubscriberCount === true ? metric("statistics.subscriberCount", undefined) : metric("statistics.subscriberCount", st.subscriberCount)], raw: body, source };
    },
  };
}

// Verified (YouTube Analytics API reports.query): GET https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate&endDate&metrics=...&filters=video==ID
// Metrics used: estimatedMinutesWatched, averageViewDuration (seconds), averageViewPercentage, shares, subscribersGained. Data lags ~2 days.
const REPORT_METRICS = ["estimatedMinutesWatched", "averageViewDuration", "averageViewPercentage", "shares", "subscribersGained"];
async function reportMetrics(f: typeof fetch, token: string, videoId: string, publishedAt: Date): Promise<{ metrics: RawMetric[]; raw: unknown }> {
  const unavailable = REPORT_METRICS.map((n) => ({ originalName: `analytics.${n}`, value: null, availability: "unavailable" as const }));
  try {
    const q = new URLSearchParams({ ids: "channel==MINE", startDate: publishedAt.toISOString().slice(0, 10), endDate: new Date().toISOString().slice(0, 10), metrics: REPORT_METRICS.join(","), filters: `video==${videoId}` });
    const res = await f(`https://youtubeanalytics.googleapis.com/v2/reports?${q}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return { metrics: unavailable, raw: { status: res.status } };
    const body = (await res.json()) as { columnHeaders?: { name: string }[]; rows?: number[][] };
    const row = body.rows?.[0], names = body.columnHeaders?.map((c) => c.name) ?? [];
    if (!row) return { metrics: unavailable, raw: body };      // no row yet: not enough data / report not ready: UNAVAILABLE, never 0
    return { metrics: REPORT_METRICS.map((n) => { const v = row[names.indexOf(n)]; return typeof v === "number" ? { originalName: `analytics.${n}`, value: v, availability: "available" as const } : { originalName: `analytics.${n}`, value: null, availability: "unavailable" as const }; }), raw: body };
  } catch { return { metrics: unavailable, raw: { error: "unreachable" } }; }
}
