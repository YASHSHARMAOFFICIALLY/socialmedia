import { errorFromResponse, platformFetch } from "../core/errors.js";
import type { AudienceResult, AudienceRow, MetricsResult, RawMetric, SocialAdapter } from "../core/types.js";
import { GRAPH } from "./instagram.auth.js";

// Verified (Instagram Platform insights docs, IG Media insights reference): GET /<MEDIA_ID>/insights?metric=... with permission
// instagram_manage_insights; media metrics comments, likes, views, reach, saved, shares, reposts, profile_visits, ig_reels_avg_watch_time.
// `impressions` is deprecated for media created after 2024-07-02 and is not requested. Data may lag up to 48 h.
// "If insights data does not exist or is unavailable the API returns an EMPTY data set instead of 0": absent metric => `unavailable`.
// Account followers: GET /<IG_ID>?fields=followers_count.
export const POST_METRICS = ["views", "reach", "likes", "comments", "saved", "shares", "reposts", "profile_visits", "ig_reels_avg_watch_time"];

// Account insights (Instagram Platform "IG User insights", verified): GET /<IG_ID>/insights?metric=...&period=day&metric_type=total_value returns each
// metric's TOTAL for the window (default: the last 24 hours) as data[].total_value.value. Demographics: metric=follower_demographics |
// engaged_audience_demographics, period=lifetime, metric_type=total_value, breakdown=age|city|country|gender, timeframe=this_month|this_week;
// result rows are total_value.breakdowns[0].results[] = { dimension_values: [...], value }. Accounts under 100 followers (100 engagements for the
// engaged audience) get an error instead of data: reported as unavailable, never as zero.
export const ACCOUNT_DAY_METRICS = ["reach", "views", "accounts_engaged", "likes", "comments", "shares", "saves", "reposts", "profile_links_taps"];
const BREAKDOWNS = ["age", "gender", "city", "country"] as const;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function createInstagramAnalytics(f: typeof fetch = fetch): Pick<SocialAdapter, "fetchPostMetrics" | "fetchAccountMetrics" | "fetchAudience"> {
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
    async fetchAccountMetrics({ accessToken, account }): Promise<MetricsResult> {
      const source = `${GRAPH}/${account.externalId}?fields=followers_count`; // a Page token's /me is the Page, not the IG account
      const res = await platformFetch(f, "instagram", source, { headers: headers(accessToken) });
      const body = (await res.json()) as { followers_count?: number; data?: { followers_count?: number }[] };
      const v = body.followers_count ?? body.data?.[0]?.followers_count;
      const metrics: RawMetric[] = [typeof v === "number" ? { originalName: "followers_count", value: v, availability: "available" } : { originalName: "followers_count", value: null, availability: "unavailable" }];
      // Daily activity totals. Best effort: the follower count above must never be lost because an insights metric is refused.
      const got = new Map<string, number>();
      const raws: unknown[] = [];
      const read = (j: { data?: { name?: string; total_value?: { value?: number } }[] }) => { for (const m of j.data ?? []) { const n = num(m.total_value?.value); if (m.name && n !== null) got.set(m.name, n); } };
      const q = (names: string[]) => `${GRAPH}/${account.externalId}/insights?metric=${names.join(",")}&period=day&metric_type=total_value`;
      const all = await f(q(ACCOUNT_DAY_METRICS), { headers: headers(accessToken) });
      if (all.ok) { const j = (await all.json()) as Parameters<typeof read>[0]; raws.push(j); read(j); }
      else if (all.status === 400) {          // one unsupported metric fails the whole request: ask one by one
        for (const name of ACCOUNT_DAY_METRICS) {
          const one = await f(q([name]), { headers: headers(accessToken) });
          if (one.status === 401 || one.status === 429 || one.status >= 500) throw errorFromResponse("instagram", one);
          if (!one.ok) continue;
          const j = (await one.json()) as Parameters<typeof read>[0]; raws.push(j); read(j);
        }
      } else if (all.status === 401 || all.status === 429 || all.status >= 500) throw errorFromResponse("instagram", all);
      for (const name of ACCOUNT_DAY_METRICS) metrics.push(got.has(name) ? { originalName: name, value: got.get(name)!, availability: "available", period: "day" } : { originalName: name, value: null, availability: "unavailable", period: "day" });
      return { metrics, raw: { profile: body, insights: raws }, source };
    },
    async fetchAudience({ accessToken, account }): Promise<AudienceResult> {
      const rows: AudienceRow[] = [], unavailable: Record<string, number | null> = {};
      for (const [kind, metric] of [["follower", "follower_demographics"], ["engaged", "engaged_audience_demographics"]] as const) {
        for (const breakdown of BREAKDOWNS) {
          const url = `${GRAPH}/${account.externalId}/insights?metric=${metric}&period=lifetime&metric_type=total_value&timeframe=this_month&breakdown=${breakdown}`;
          const res = await f(url, { headers: headers(accessToken) });
          if (res.status === 401 || res.status === 429 || res.status >= 500) throw errorFromResponse("instagram", res);
          if (!res.ok) { unavailable[`${metric}_${breakdown}`] = res.status; continue; }       // typically: fewer than 100 followers
          const j = (await res.json()) as { data?: { total_value?: { breakdowns?: { results?: { dimension_values?: string[]; value?: number }[] }[] } }[] };
          const results = j.data?.[0]?.total_value?.breakdowns?.[0]?.results ?? [];
          const values: Record<string, number> = {};
          for (const r of results) { const n = num(r.value); if (n !== null && Array.isArray(r.dimension_values)) values[r.dimension_values.join("/")] = n; }
          if (Object.keys(values).length) rows.push({ kind, breakdown, timeframe: "this_month", values }); else unavailable[`${metric}_${breakdown}`] = null;
        }
      }
      return { rows, unavailable };
    },
  };
}
