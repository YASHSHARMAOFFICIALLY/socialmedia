import { describe, it, expect } from "vitest";
import { engagementRate, nextCollectionDelayS, normalize } from "../src/modules/analytics/analytics.normalizer.js";
import { carryForwardSum, sumSeries } from "../src/modules/analytics/analytics.aggregator.js";
import { bucketFloor, defaultRange } from "../src/modules/analytics/analytics.service.js";
import { failureDelay } from "../src/workers/analytics/collect.js";
import { PlatformError } from "../src/integrations/core/errors.js";
import { metricsOf } from "./helpers/fake-adapter.js";

const by = (xs: ReturnType<typeof normalize>) => Object.fromEntries(xs.map((x) => [x.key, x]));

describe("metric normalization", () => {
  it("maps X public_metrics to the canonical vocabulary, preserving the original name and definition", () => {
    const n = by(normalize("x", metricsOf({ "public_metrics.impression_count": 1000, "public_metrics.like_count": 40, "public_metrics.reply_count": 5, "public_metrics.retweet_count": 7, "public_metrics.quote_count": 2, "public_metrics.bookmark_count": 3 }).metrics, "post"));
    expect(n.impressions).toMatchObject({ value: 1000, originalName: "public_metrics.impression_count", availability: "available" });
    expect(n.comments!.originalName).toBe("public_metrics.reply_count");
    expect(n.reposts!.value).toBe(7);
    expect(n.likes!.definition).toMatch(/like_count/);
  });
  it("keeps UNAVAILABLE distinct from zero, and never derives numbers from missing data", () => {
    const n = by(normalize("instagram", metricsOf({ views: 0, likes: 12, comments: null, saved: null, shares: 0 }).metrics, "post"));
    expect(n.views).toMatchObject({ value: 0, availability: "available" });          // a real zero
    expect(n.comments).toMatchObject({ value: null, availability: "unavailable" });  // not zero
    expect(n.saves).toMatchObject({ value: null, availability: "unavailable" });
  });
  it("derives interactions ONLY from components the platform reported, and says which", () => {
    const ig = by(normalize("instagram", metricsOf({ likes: 10, comments: 2, saved: 4, shares: null, reposts: 0 }).metrics, "post"));
    expect(ig.interactions).toMatchObject({ value: 16, availability: "available" });
    expect(ig.interactions!.components!.sort()).toEqual(["comments", "likes", "reposts", "saves"]);
    const yt = by(normalize("youtube", metricsOf({ "statistics.viewCount": 900, "statistics.likeCount": 30, "statistics.commentCount": 3 }).metrics, "post"));
    expect(yt.interactions!.value).toBe(33);
    expect(yt.interactions!.components!.sort()).toEqual(["comments", "likes"]);       // YouTube exposes no shares: not pretended
    const none = by(normalize("instagram", metricsOf({ likes: null, comments: null }).metrics, "post"));
    expect(none.interactions).toMatchObject({ value: null, availability: "unavailable" });
  });
  it("does not derive interactions for accounts and converts units (Instagram watch time ms -> s)", () => {
    expect(normalize("x", metricsOf({ "public_metrics.followers_count": 500 }).metrics, "account").map((m) => m.key)).toEqual(["followers"]);
    expect(by(normalize("instagram", metricsOf({ ig_reels_avg_watch_time: 4500 }).metrics, "post")).avg_watch_time_seconds!.value).toBe(4.5);
  });
  it("ignores metrics it has no mapping for (they stay in the raw snapshot) and LinkedIn has none", () => {
    expect(normalize("x", metricsOf({ "public_metrics.mystery": 9 }).metrics, "post")).toEqual([]);
    expect(normalize("linkedin", metricsOf({ anything: 1 }).metrics, "post")).toEqual([]);
  });
});

describe("engagement rate and cadence", () => {
  it("uses impressions, then reach, then views as denominator and always reports which", () => {
    expect(engagementRate({ interactions: 50, impressions: 1000, views: 200 })).toEqual({ rate: 0.05, denominator: "impressions" });
    expect(engagementRate({ interactions: 50, reach: 500 })).toEqual({ rate: 0.1, denominator: "reach" });
    expect(engagementRate({ interactions: 30, views: 300 })).toEqual({ rate: 0.1, denominator: "views" });
    expect(engagementRate({ interactions: 5, impressions: 0 })).toBeNull();           // no division by zero, no made-up rate
    expect(engagementRate({ impressions: 100 })).toBeNull();
  });
  it("polls fresh posts often and old posts rarely, then stops", () => {
    expect(nextCollectionDelayS("post", 3600)).toBe(3600);
    expect(nextCollectionDelayS("post", 3 * 86400)).toBe(6 * 3600);
    expect(nextCollectionDelayS("post", 20 * 86400)).toBe(86400);
    expect(nextCollectionDelayS("post", 60 * 86400)).toBe(7 * 86400);
    expect(nextCollectionDelayS("post", 100 * 86400)).toBeNull();
    expect(nextCollectionDelayS("account", 0)).toBe(86400);
  });
  it("failure policy: rate limits wait, transient errors back off, permanent ones eventually disable", () => {
    expect(failureDelay(new PlatformError("rate_limited", "x", { retryAfterS: 7200 }), 0)).toEqual({ delayS: 7200, disable: false });
    expect(failureDelay(new PlatformError("retryable", "x"), 2)).toEqual({ delayS: 1200, disable: false });
    expect(failureDelay(new PlatformError("permanent", "x"), 3).disable).toBe(false);
    expect(failureDelay(new PlatformError("permanent", "x"), 4).disable).toBe(true);
    expect(failureDelay(new PlatformError("auth_expired", "x"), 9).disable).toBe(false);
  });
});

describe("series helpers", () => {
  it("sums buckets and flags partial ones instead of hiding missing data", () => {
    expect(sumSeries([{ bucket: "2030-01-01", value: 5 }, { bucket: "2030-01-01", value: null }, { bucket: "2030-01-02", value: null }, { bucket: "2030-01-03", value: 2 }]))
      .toEqual([{ bucket: "2030-01-01", value: 5, partial: true }, { bucket: "2030-01-02", value: null, partial: true }, { bucket: "2030-01-03", value: 2, partial: false }]);
  });
  it("carries follower counts forward between collections", () => {
    const s = carryForwardSum([{ account: "a", bucket: "d1", value: 100 }, { account: "b", bucket: "d1", value: 10 }, { account: "a", bucket: "d2", value: 110 }, { account: "b", bucket: "d3", value: 12 }]);
    expect(s).toEqual([{ bucket: "d1", value: 110, partial: false }, { bucket: "d2", value: 120, partial: false }, { bucket: "d3", value: 122, partial: false }]);
    expect(carryForwardSum([{ account: "a", bucket: "d1", value: 5 }, { account: "b", bucket: "d2", value: 7 }])[0]).toEqual({ bucket: "d1", value: 5, partial: true });
  });
  it("floors dates to ISO week (Monday) and month starts; default range is the last 30 days", () => {
    expect(bucketFloor("2030-06-12", "week")).toBe("2030-06-10");
    expect(bucketFloor("2030-06-16", "week")).toBe("2030-06-10");                    // Sunday belongs to the previous Monday's week
    expect(bucketFloor("2030-06-12", "month")).toBe("2030-06-01");
    expect(defaultRange(new Date("2030-06-30T12:00:00Z"))).toEqual({ from: "2030-06-01", to: "2030-06-30" });
  });
});
