import { describe, it, expect } from "vitest";
import { createYouTubeAdapter } from "../src/integrations/youtube/youtube.adapter.js";
import { youtubeRules } from "../src/integrations/youtube/youtube.rules.js";
import { normalize } from "../src/modules/analytics/analytics.normalizer.js";
import type { PublishInput, ResolvedMedia } from "../src/integrations/core/types.js";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
const harness = (route: (c: Call) => Response) => {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit = {}) => { const c = { url: String(url), method: init.method ?? "GET", headers: Object.fromEntries(new Headers(init.headers).entries()), body: init.body }; calls.push(c); return route(c); }) as unknown as typeof fetch;
  return { calls, adapter: createYouTubeAdapter({ clientId: "c", clientSecret: "s" }, f) };
};
const media = (kind: "image" | "video", role: "media" | "thumbnail", size = 1000, mime = kind === "image" ? "image/png" : "video/mp4"): ResolvedMedia => ({ id: "m", kind, role, mimeType: mime, sizeBytes: size, storageKey: "k", url: async () => `https://r2.example/${role}` });
const input = (m: ResolvedMedia[]): PublishInput => ({ accessToken: "T", account: { externalId: "UC1", metadata: {} }, content: { text: "t", title: "Title", description: null, hashtags: [], media: [], metadata: {} }, media: m, idempotencyKey: "k", signal: new AbortController().signal });
const uploadRoute = (extra: (c: Call) => Response | undefined) => (c: Call) =>
  extra(c) ?? (c.url.includes("uploadType=resumable") && c.method === "POST" ? new Response(null, { headers: { location: "https://up/s" } })
    : c.url === "https://r2.example/media" ? new Response(new Uint8Array(1000), { status: 200 }) : c.url === "https://up/s" ? Response.json({ id: "VID1" }) : new Response("?", { status: 404 }));

describe("YouTube custom thumbnails", () => {
  it("uploads the thumbnail with thumbnails.set after the video, using the video id", async () => {
    const h = harness(uploadRoute((c) => c.url === "https://r2.example/thumbnail" ? new Response(new Uint8Array([1, 2, 3])) : c.url.includes("thumbnails/set") ? Response.json({ items: [] }) : undefined));
    const r = await h.adapter.publish!(input([media("video", "media"), media("image", "thumbnail")]));
    expect(r.externalId).toBe("VID1");
    expect(r.warnings).toBeUndefined();
    const set = h.calls.find((c) => c.url.includes("thumbnails/set"))!;
    expect(set.url).toBe("https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=VID1");
    expect(set.headers).toMatchObject({ authorization: "Bearer T", "content-type": "image/png" });
  });
  it("a rejected thumbnail never fails or retries the publication: the video stays published and a warning is returned", async () => {
    const h = harness(uploadRoute((c) => c.url === "https://r2.example/thumbnail" ? new Response(new Uint8Array([1])) : c.url.includes("thumbnails/set") ? Response.json({ error: { message: "channel not verified", errors: [{ reason: "forbidden" }] } }, { status: 403 }) : undefined));
    const r = await h.adapter.publish!(input([media("video", "media"), media("image", "thumbnail")]));
    expect(r.externalId).toBe("VID1");
    expect(r.warnings![0]).toMatch(/video published, but the custom thumbnail was not set/i);
    expect(h.calls.filter((c) => c.url.includes("uploadType=resumable") && c.method === "POST")).toHaveLength(1);   // no second upload
  });
  it("rules: JPEG/PNG only, size advisory, verified-channel advisory", () => {
    const v = { kind: "video" as const, role: "media" as const, mimeType: "video/mp4", sizeBytes: 1000 };
    const codes = (th: object) => youtubeRules.validate({ text: "", title: "t", description: null, hashtags: [], media: [v, { kind: "image", role: "thumbnail", mimeType: "image/png", sizeBytes: 1000, ...th } as never], metadata: {} }).map((i) => `${i.severity}:${i.code}`);
    expect(codes({})).toEqual(["warning:THUMBNAIL_CHANNEL_UNVERIFIED"]);
    expect(codes({ mimeType: "image/gif" })).toContain("error:THUMBNAIL_FORMAT");
    expect(codes({ sizeBytes: 3 * 1024 * 1024 })).toContain("warning:THUMBNAIL_SIZE_UNVERIFIED");
  });
});

describe("YouTube Analytics API metrics", () => {
  const videoStats = { items: [{ statistics: { viewCount: "500", likeCount: "20", commentCount: "3" } }] };
  const run = (reportRes: () => Response) => {
    const h = harness((c) => c.url.includes("/youtube/v3/videos") ? Response.json(videoStats) : reportRes());
    return h.adapter.fetchPostMetrics!({ accessToken: "T", account: { externalId: "UC1", metadata: {} }, externalPostId: "VID1", publishedAt: new Date("2030-01-01T00:00:00Z") }).then((m) => ({ m, calls: h.calls }));
  };
  it("adds watch time, average view duration/percentage, shares and subscribers gained; normalization converts units", async () => {
    const { m, calls } = await run(() => Response.json({ columnHeaders: [{ name: "estimatedMinutesWatched" }, { name: "averageViewDuration" }, { name: "averageViewPercentage" }, { name: "shares" }, { name: "subscribersGained" }].reverse().reverse(), rows: [[120, 45, 38.5, 4, 2]] }));
    const q = new URL(calls.find((c) => c.url.includes("youtubeanalytics"))!.url);
    expect(q.searchParams.get("ids")).toBe("channel==MINE");
    expect(q.searchParams.get("filters")).toBe("video==VID1");
    expect(q.searchParams.get("startDate")).toBe("2030-01-01");
    const n = Object.fromEntries(normalize("youtube", m.metrics, "post").map((x) => [x.key, x]));
    expect(n.watch_time_seconds!.value).toBe(7200);                  // 120 minutes
    expect(n.avg_watch_time_seconds!.value).toBe(45);
    expect(n.avg_view_percentage!.value).toBeCloseTo(0.385, 5);
    expect(n.shares!.value).toBe(4);
    expect(n.subscribers_gained!.value).toBe(2);
    expect(n.views!.value).toBe(500);
    expect(n.interactions!.value).toBe(27);                          // likes 20 + comments 3 + shares 4
  });
  it("when the scope was not granted or no data exists yet, those metrics are UNAVAILABLE and the collection still succeeds", async () => {
    for (const res of [() => new Response("forbidden", { status: 403 }), () => Response.json({ columnHeaders: [{ name: "shares" }], rows: [] }), () => { throw new Error("net"); }]) {
      const { m } = await run(res as () => Response);
      const n = Object.fromEntries(normalize("youtube", m.metrics, "post").map((x) => [x.key, x]));
      expect(n.views!.value).toBe(500);
      expect(n.watch_time_seconds).toMatchObject({ value: null, availability: "unavailable" });
      expect(n.interactions!.value).toBe(23);                        // only the components that exist
    }
  });
});

import { createXAdapter } from "../src/integrations/x/x.adapter.js";
describe("X non-public metrics", () => {
  const run = (nonPublic: () => Response) => {
    const calls: string[] = [];
    const f = (async (u: string) => { calls.push(String(u)); return String(u).includes("non_public") ? nonPublic() : Response.json({ data: { public_metrics: { like_count: 5, reply_count: 1, retweet_count: 0, quote_count: 0, impression_count: 100, bookmark_count: 0 } } }); }) as unknown as typeof fetch;
    return createXAdapter({ clientId: "c", clientSecret: "s" }, f).fetchPostMetrics!({ accessToken: "T", account: { externalId: "1", metadata: {} }, externalPostId: "99", publishedAt: new Date() }).then((m) => ({ m, calls }));
  };
  it("adds link clicks and profile clicks when X returns them; unavailable (not zero) when the window passed or access is denied", async () => {
    const { m, calls } = await run(() => Response.json({ data: { non_public_metrics: { url_link_clicks: 12, user_profile_clicks: 3, impression_count: 100 } } }));
    const n = Object.fromEntries(normalize("x", m.metrics, "post").map((x) => [x.key, x]));
    expect(n.clicks!.value).toBe(12);
    expect(n.profile_visits!.value).toBe(3);
    expect(calls[1]).toContain("tweet.fields=non_public_metrics");
    for (const res of [() => new Response("{}", { status: 403 }), () => Response.json({ data: {} }), () => { throw new Error("net"); }]) {
      const { m: m2 } = await run(res as () => Response);
      const n2 = Object.fromEntries(normalize("x", m2.metrics, "post").map((x) => [x.key, x]));
      expect(n2.likes!.value).toBe(5);                               // the public collection is unaffected
      expect(n2.clicks).toMatchObject({ value: null, availability: "unavailable" });
    }
  });
});
