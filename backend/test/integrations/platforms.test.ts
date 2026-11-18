import { describe, it, expect } from "vitest";
import { xRules } from "../../src/integrations/x/x.rules.js";
import { createXAdapter } from "../../src/integrations/x/x.adapter.js";
import { youtubeRules } from "../../src/integrations/youtube/youtube.rules.js";
import { createYouTubeAdapter } from "../../src/integrations/youtube/youtube.adapter.js";
import { createInstagramAdapter } from "../../src/integrations/instagram/instagram.adapter.js";
import type { ContentInput } from "../../src/integrations/core/rules.js";
import type { PublishInput, ResolvedMedia } from "../../src/integrations/core/types.js";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
const harness = (route: (c: Call) => Response | Promise<Response>) => {
  const calls: Call[] = [];
  const f = (async (url: string | URL | Request, init: RequestInit = {}) => {
    const body = typeof init.body === "string" ? (init.body.startsWith("{") ? JSON.parse(init.body) : init.body) : init.body;
    const c: Call = { url: String(url), method: init.method ?? "GET", headers: Object.fromEntries(new Headers(init.headers).entries()), body };
    calls.push(c);
    return route(c);
  }) as typeof fetch;
  return { f, calls };
};
const content = (o: Partial<ContentInput> = {}): ContentInput => ({ text: "Hello", title: null, description: null, hashtags: [], media: [], metadata: {}, ...o });
const mk = (kind: "image" | "video", size: number, mime = kind === "image" ? "image/jpeg" : "video/mp4"): ResolvedMedia => ({ id: "m", kind, role: "media", mimeType: mime, sizeBytes: size, storageKey: "k", url: async () => "https://r2.example/obj" });
const input = (c: ContentInput, m: ResolvedMedia[] = [], meta: Record<string, unknown> = {}): PublishInput => ({ accessToken: "TOKEN", account: { externalId: "u1", metadata: meta }, content: c, media: m, idempotencyKey: "k", signal: new AbortController().signal });
const rangeResp = (c: Call, total = 1000) => { const m = /bytes=(\d+)-(\d*)/.exec(c.headers.range ?? ""); const a = m ? Number(m[1]) : 0; const b = m && m[2] ? Number(m[2]) : total - 1; return new Response(new Uint8Array(b - a + 1), { status: m ? 206 : 200 }); };

describe("X adapter (mocked API)", () => {
  const ad = (f: typeof fetch) => createXAdapter({ clientId: "cid", clientSecret: "sec", pollMs: 1 }, f);
  it("builds a PKCE authorize URL with the documented scopes, and exchanges codes with basic auth", async () => {
    const h = harness(() => Response.json({ access_token: "A", refresh_token: "R", expires_in: 7200, scope: "tweet.read tweet.write offline.access" }));
    const a = ad(h.f);
    const u = new URL(a.oauth.authorizationUrl({ state: "S", redirectUri: "https://api/cb", codeChallenge: "CH" }));
    expect(u.origin + u.pathname).toBe("https://x.com/i/oauth2/authorize");
    expect(u.searchParams.get("code_challenge")).toBe("CH");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("scope")).toMatch(/offline\.access/);
    const t = await a.oauth.exchangeCode({ code: "C", redirectUri: "https://api/cb", codeVerifier: "V" });
    expect(h.calls[0]!.url).toBe("https://api.x.com/2/oauth2/token");
    expect(h.calls[0]!.headers.authorization).toMatch(/^Basic /);
    expect(String(h.calls[0]!.body)).toContain("code_verifier=V");
    expect(t).toMatchObject({ accessToken: "A", refreshToken: "R", scopes: ["tweet.read", "tweet.write", "offline.access"] });
    expect(a.oauth.usesPkce).toBe(true);
  });
  it("posts text with hashtags appended", async () => {
    const h = harness(() => Response.json({ data: { id: "123" } }, { status: 201 }));
    const r = await ad(h.f).publish!(input(content({ hashtags: ["ai"] }), [], { username: "ada" }));
    expect(h.calls[0]).toMatchObject({ url: "https://api.x.com/2/tweets", method: "POST", body: { text: "Hello\n\n#ai" } });
    expect(r).toMatchObject({ externalId: "123", url: "https://x.com/ada/status/123" });
  });
  it("chunked media upload: initialize -> append (segments) -> finalize -> status poll -> tweet with media_ids", async () => {
    let polls = 0;
    const size = 5 * 1024 * 1024;
    const h = harness((c) => {
      if (c.url.endsWith("/media/upload/initialize")) return Response.json({ data: { id: "MID" } });
      if (c.url === "https://r2.example/obj") return rangeResp(c, size);
      if (c.url.endsWith("/append")) return new Response(null, { status: 204 });
      if (c.url.endsWith("/finalize")) return Response.json({ data: { id: "MID", processing_info: { state: "pending", check_after_secs: 1 } } });
      if (c.url.includes("command=STATUS")) return Response.json({ data: { processing_info: { state: ++polls < 2 ? "in_progress" : "succeeded" } } });
      return Response.json({ data: { id: "T1" } }, { status: 201 });
    });
    await ad(h.f).publish!(input(content(), [mk("video", size)]));
    expect(h.calls[0]!.body).toEqual({ media_type: "video/mp4", total_bytes: size, media_category: "tweet_video" });
    expect(h.calls.filter((c) => c.url.endsWith("/append"))).toHaveLength(2);       // 4 MB + 1 MB
    expect(polls).toBe(2);
    expect(h.calls.at(-1)!.body).toMatchObject({ media: { media_ids: ["MID"] } });
  });
  it("failed media processing is permanent; 429 uses x-rate-limit-reset; create-call ambiguity is unknown", async () => {
    const failing = harness((c) => c.url.endsWith("/initialize") ? Response.json({ data: { id: "M" } }) : c.url === "https://r2.example/obj" ? rangeResp(c, 10) : c.url.endsWith("/append") ? new Response(null) : Response.json({ data: { processing_info: { state: "failed", error: { message: "bad codec" } } } }));
    expect(await ad(failing.f).publish!(input(content(), [mk("image", 10)])).catch((e) => e)).toMatchObject({ kind: "permanent" });
    const reset = String(Math.floor(Date.now() / 1000) + 600);
    const rl = await ad(harness(() => new Response("{}", { status: 429, headers: { "x-rate-limit-reset": reset } })).f).publish!(input(content())).catch((e) => e);
    expect(rl.kind).toBe("rate_limited");
    expect(rl.opts.retryAfterS).toBeGreaterThan(550);
    expect(await ad(harness(() => new Response("x", { status: 503 })).f).publish!(input(content())).catch((e) => e)).toMatchObject({ kind: "unknown" });
    expect(await ad(harness(() => new Response("dup", { status: 403 })).f).publish!(input(content())).catch((e) => e)).toMatchObject({ kind: "permanent" });
  });
  it("reconciles by matching recent tweets", async () => {
    const h = harness(() => Response.json({ data: [{ id: "9", text: "Hello", created_at: new Date().toISOString() }] }));
    const hit = await ad(h.f).reconcile!({ accessToken: "T", account: { externalId: "u1", metadata: {} }, content: content(), idempotencyKey: "k", since: new Date(Date.now() - 60_000) });
    expect(hit).toEqual({ externalId: "9" });
    expect(await ad(harness(() => Response.json({ data: [] })).f).reconcile!({ accessToken: "T", account: { externalId: "u1", metadata: {} }, content: content(), idempotencyKey: "k", since: new Date() })).toBeNull();
  });
  it("reconcile matches a tweet whose link X rewrote to t.co, and skips ids other jobs already own", async () => {
    const now = new Date().toISOString();
    const tweets = [
      { id: "taken", text: "See https://t.co/a1", created_at: now },
      { id: "10", text: "See https://t.co/b2", created_at: now },
    ];
    const h = harness(() => Response.json({ data: tweets }));
    const hit = await ad(h.f).reconcile!({
      accessToken: "T",
      account: { externalId: "u1", metadata: {} },
      content: content({ text: "See https://example.com/x" }),
      idempotencyKey: "k",
      since: new Date(Date.now() - 60_000),
      exclude: ["taken"],
    });
    expect(hit).toEqual({ externalId: "10" });
  });
  it("threads: each further tweet replies to the previous; a mid-thread failure keeps the post successful with a warning (never re-published)", async () => {
    let n = 0;
    const h = harness((c) => (c.url.endsWith("/tweets") ? Response.json({ data: { id: `T${++n}` } }, { status: 201 }) : Response.json({})));
    const r = await ad(h.f).publish!(input(content({ metadata: { thread: ["two", "three"] } })));
    expect(r.externalId).toBe("T1");
    expect(h.calls.map((c) => (c.body as { reply?: { in_reply_to_tweet_id: string } }).reply?.in_reply_to_tweet_id)).toEqual([undefined, "T1", "T2"]);
    expect(r.raw).toMatchObject({ thread: ["T1", "T2", "T3"] });
    let k = 0;
    const h2 = harness((c) => (++k === 2 ? new Response("x", { status: 500 }) : Response.json({ data: { id: `A${k}` } }, { status: 201 })));
    const r2 = await ad(h2.f).publish!(input(content({ metadata: { thread: ["two", "three"] } })));
    expect(r2.externalId).toBe("A1");
    expect(r2.warnings?.[0]).toMatch(/NOT posted/);
  });

  it("polls: sent as poll.options + duration_minutes; rules enforce 2-4 short options, 5-10080 minutes, no media", async () => {
    const h = harness(() => Response.json({ data: { id: "P1" } }, { status: 201 }));
    await ad(h.f).publish!(input(content({ metadata: { poll: { options: ["a", "b"], durationMinutes: 60 } } })));
    expect((h.calls[0]!.body as { poll: unknown }).poll).toEqual({ options: ["a", "b"], duration_minutes: 60 });
    const codes = (poll: unknown, media: unknown[] = []) => xRules.validate(content({ media: media as never, metadata: { poll } })).map((x) => x.code);
    expect(codes({ options: ["a", "b"], durationMinutes: 60 })).toEqual([]);
    expect(codes({ options: ["a"], durationMinutes: 60 })).toContain("POLL_INVALID");
    expect(codes({ options: ["a", "x".repeat(26)], durationMinutes: 60 })).toContain("POLL_INVALID");
    expect(codes({ options: ["a", "b"], durationMinutes: 1 })).toContain("POLL_DURATION");
    expect(codes({ options: ["a", "b"], durationMinutes: 60 }, [{ kind: "image", role: "media", mimeType: "image/jpeg", sizeBytes: 1 }])).toContain("POLL_WITH_MEDIA");
  });

  it("thread rules: 1-24 non-empty tweets of at most 280 characters", () => {
    const rules = xRules;
    const codes = (thread: unknown) => rules.validate(content({ metadata: { thread } })).map((x) => x.code);
    expect(codes(["fine"])).toEqual([]);
    expect(codes([])).toContain("THREAD_INVALID");
    expect(codes(["ok", " "])).toContain("THREAD_INVALID");
    expect(codes("nope")).toContain("THREAD_INVALID");
    expect(codes(["x".repeat(281)])).toContain("TEXT_TOO_LONG");
  });
});

describe("YouTube adapter (mocked API)", () => {
  const ad = (f: typeof fetch) => createYouTubeAdapter({ clientId: "cid", clientSecret: "sec" }, f);
  it("requests offline access with consent and the upload scope", () => {
    const u = new URL(ad(harness(() => Response.json({})).f).oauth.authorizationUrl({ state: "S", redirectUri: "https://api/cb" }));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");
    expect(u.searchParams.get("scope")).toContain("youtube.upload");
  });
  it("maps the channel to an account with its uploads playlist", async () => {
    const a = await ad(harness(() => Response.json({ items: [{ id: "UC1", snippet: { title: "My Channel", customUrl: "@me" }, contentDetails: { relatedPlaylists: { uploads: "UU1" } } }] })).f).fetchAccount("T");
    expect(a).toMatchObject({ externalId: "UC1", displayName: "My Channel", accountType: "channel", metadata: { uploadsPlaylistId: "UU1" } });
  });
  it("resumable upload: init with size/type headers, then PUT the file to the session URI", async () => {
    const h = harness((c) => {
      if (c.url.includes("uploadType=resumable") && c.method === "POST") return new Response(null, { status: 200, headers: { location: "https://upload.example/session1" } });
      if (c.url === "https://r2.example/obj") return rangeResp(c);
      return Response.json({ id: "VID1" });
    });
    const r = await ad(h.f).publish!(input(content({ title: "My video", description: "d", hashtags: ["a"], metadata: { privacyStatus: "unlisted" } }), [mk("video", 1000)]));
    const init = h.calls[0]!;
    expect(init.headers).toMatchObject({ authorization: "Bearer TOKEN", "x-upload-content-length": "1000", "x-upload-content-type": "video/mp4" });
    expect(init.body).toMatchObject({ snippet: { title: "My video", description: "d", tags: ["a"] }, status: { privacyStatus: "unlisted" } });
    expect(h.calls.at(-1)).toMatchObject({ url: "https://upload.example/session1", method: "PUT" });
    expect(r).toMatchObject({ externalId: "VID1", url: "https://www.youtube.com/watch?v=VID1" });
  });
  it("a dropped connection is resolved by asking the session how much arrived, then resuming from the next byte (no duplicate video)", async () => {
    let puts = 0;
    const h = harness((c) => {
      if (c.url.includes("uploadType=resumable") && c.method === "POST") return new Response(null, { headers: { location: "https://upload.example/s" } });
      if (c.url === "https://r2.example/obj") return rangeResp(c, 1000);
      if (c.url === "https://upload.example/s" && c.method === "PUT") {
        puts++;
        if (c.headers["content-range"] === "bytes */1000") return new Response(null, { status: 308, headers: { range: "bytes=0-499" } });
        if (puts === 1) throw new Error("socket hang up");
        return Response.json({ id: "VID2" });
      }
      return new Response(null, { status: 404 });
    });
    const r = await ad(h.f).publish!(input(content({ title: "t" }), [mk("video", 1000)]));
    expect(r.externalId).toBe("VID2");
    expect(h.calls.filter((c) => c.url.includes("uploadType=resumable") && c.method === "POST")).toHaveLength(1);   // session created once
    const resumed = h.calls.filter((c) => c.method === "PUT").at(-1)!;
    expect(resumed.headers["content-range"]).toBe("bytes 500-999/1000");
  });
  it("an upload that actually completed before the connection dropped is detected, not repeated", async () => {
    let first = true;
    const h = harness((c) => {
      if (c.method === "POST") return new Response(null, { headers: { location: "https://upload.example/s" } });
      if (c.url === "https://r2.example/obj") return rangeResp(c);
      if (c.headers["content-range"] === "bytes */1000") return Response.json({ id: "DONE" }, { status: 200 });
      if (first) { first = false; throw new Error("reset"); }
      return Response.json({ id: "WRONG" });
    });
    expect((await ad(h.f).publish!(input(content({ title: "t" }), [mk("video", 1000)]))).externalId).toBe("DONE");
  });
  it("classifies API errors: quota exceeded waits for the reset, auth errors, init failures", async () => {
    const err = (status: number, reason: string) => harness(() => Response.json({ error: { message: "x", errors: [{ reason }] } }, { status }));
    const q = await ad(err(403, "quotaExceeded").f).publish!(input(content({ title: "t" }), [mk("video", 10)])).catch((e) => e);
    expect(q).toMatchObject({ kind: "rate_limited" });
    expect(q.opts.retryAfterS).toBeGreaterThanOrEqual(60);
    expect(await ad(err(401, "authError").f).publish!(input(content({ title: "t" }), [mk("video", 10)])).catch((e) => e)).toMatchObject({ kind: "auth_expired" });
    expect(await ad(err(400, "invalidTitle").f).publish!(input(content({ title: "t" }), [mk("video", 10)])).catch((e) => e)).toMatchObject({ kind: "permanent" });
    expect(await ad(harness(() => new Response("x", { status: 503 })).f).publish!(input(content({ title: "t" }), [mk("video", 10)])).catch((e) => e)).toMatchObject({ kind: "retryable" });   // init: nothing created yet
  });
  it("reconciles via the uploads playlist by title and time", async () => {
    const recent = new Date().toISOString();
    const h = harness(() => Response.json({ items: [{ snippet: { title: "Other", publishedAt: recent, resourceId: { videoId: "x" } } }, { snippet: { title: "Mine", publishedAt: recent, resourceId: { videoId: "V9" } } }] }));
    const acc = { externalId: "UC1", metadata: { uploadsPlaylistId: "UU1" } };
    expect(await ad(h.f).reconcile!({ accessToken: "T", account: acc, content: content({ title: "Mine" }), idempotencyKey: "k", since: new Date(Date.now() - 60_000) })).toMatchObject({ externalId: "V9" });
    expect(await ad(h.f).reconcile!({ accessToken: "T", account: acc, content: content({ title: "Absent" }), idempotencyKey: "k", since: new Date(0) })).toBeNull();
  });
  it("publishAt: uploaded private with status.publishAt; rules reject past dates, bad dates and non-private privacy", async () => {
    const at = new Date(Date.now() + 86_400_000).toISOString();
    const h = harness((c) => (c.url.includes("uploadType=resumable") ? new Response("", { status: 200, headers: { location: "https://up.example/s" } }) : Response.json({ id: "V1" })));
    await createYouTubeAdapter({ clientId: "c", clientSecret: "s" }, h.f).publish!(input(content({ title: "t", metadata: { publishAt: at, privacyStatus: "public" } }), [mk("video", 10)])).catch(() => null);
    expect((h.calls[0]!.body as { status: Record<string, unknown> }).status).toMatchObject({ privacyStatus: "private", publishAt: at });
    const codes = (m: Record<string, unknown>) => youtubeRules.validate(content({ title: "t", media: [{ kind: "video", role: "media", mimeType: "video/mp4", sizeBytes: 10 } as never], metadata: m })).map((x) => x.code);
    expect(codes({ publishAt: at })).not.toContain("PUBLISH_AT_PAST");
    expect(codes({ publishAt: "2020-01-01T00:00:00Z" })).toContain("PUBLISH_AT_PAST");
    expect(codes({ publishAt: "soon" })).toContain("PUBLISH_AT_INVALID");
    expect(codes({ publishAt: at, privacyStatus: "public" })).toContain("PUBLISH_AT_PRIVACY");
  });
});

describe("Instagram adapter (mocked API)", () => {
  const ad = (f: typeof fetch) => createInstagramAdapter({ clientId: "app", clientSecret: "sec", pollMs: 1 }, f);
  it("authorizes through the Facebook Login dialog: scope list by default, config_id when configured", () => {
    const u = new URL(ad(fetch).oauth.authorizationUrl({ state: "S", redirectUri: "https://api/oauth/instagram/callback" }));
    expect(u.origin + u.pathname).toBe("https://www.facebook.com/v27.0/dialog/oauth");
    expect(u.searchParams.get("client_id")).toBe("app");
    expect(u.searchParams.get("redirect_uri")).toBe("https://api/oauth/instagram/callback");
    expect(u.searchParams.get("scope")).toBe("instagram_basic,instagram_content_publish,instagram_manage_insights,pages_show_list,pages_read_engagement,business_management");
    expect(u.searchParams.get("config_id")).toBeNull();
    const c = new URL(createInstagramAdapter({ clientId: "app", clientSecret: "sec", configId: "CFG" }, fetch).oauth.authorizationUrl({ state: "S", redirectUri: "https://api/cb" }));
    expect(c.searchParams.get("config_id")).toBe("CFG");
    expect(c.searchParams.get("scope")).toBeNull();
  });
  it("exchanges the code for a long-lived Facebook user token, then connects each Page-linked Instagram account with the Page token", async () => {
    const h = harness((c) => c.url.includes("oauth/access_token") ? Response.json({ access_token: c.url.includes("fb_exchange_token") ? "LONG" : "SHORT" })
      : c.url.includes("/me?") ? Response.json({ id: "fb-user-1" }) : Response.json({ data: [
        { id: "p1", name: "Shop", access_token: "PT1", instagram_business_account: { id: "1784", username: "shop.ig", profile_picture_url: "https://pic" } },
        { id: "p2", name: "No IG", access_token: "PT2" }] }));
    const a = ad(h.f);
    const t = await a.oauth.exchangeCode({ code: "C", redirectUri: "https://api/cb" });
    expect(h.calls[0]!.url).toMatch(/^https:\/\/graph\.facebook\.com\/v27\.0\/oauth\/access_token\?/);
    expect(h.calls[1]!.url).toContain("grant_type=fb_exchange_token");
    expect(t.accessToken).toBe("LONG");
    const found = await a.listAccounts!(t);
    const me = new URL(h.calls.find((c) => c.url.includes("/me/accounts"))!.url);
    expect(me.origin + me.pathname).toBe("https://graph.facebook.com/v27.0/me/accounts");
    expect(me.searchParams.get("fields")).toContain("instagram_business_account{id,username,profile_picture_url}");
    expect(h.calls.find((c) => c.url.includes("/me/accounts"))!.headers.authorization).toBe("Bearer LONG");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ profile: { externalId: "1784", username: "shop.ig", avatarUrl: "https://pic", metadata: { pageId: "p1", fbUserId: "fb-user-1" } }, tokens: { accessToken: "PT1" } });
  });
  it("fails the connect with a clear message when no granted Page has a linked Instagram account", async () => {
    const h = harness((c) => c.url.includes("/me?") ? Response.json({ id: "fb-user-1" }) : Response.json({ data: [{ id: "p2", name: "No IG", access_token: "PT2" }] }));
    await expect(ad(h.f).listAccounts!({ accessToken: "LONG", scopes: [] })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/Instagram professional account/) });
  });
  it("publishes an image: container -> status FINISHED -> media_publish -> permalink", async () => {
    let status = 0;
    const h = harness((c) => {
      if (c.url.endsWith("/u1/media") && c.method === "POST") return Response.json({ id: "CON1" });
      if (c.url.includes("fields=status_code")) return Response.json({ status_code: ++status < 2 ? "IN_PROGRESS" : "FINISHED" });
      if (c.url.endsWith("/u1/media_publish")) return Response.json({ id: "MEDIA1" });
      return Response.json({ permalink: "https://instagram.com/p/abc" });
    });
    const r = await ad(h.f).publish!(input(content({ hashtags: ["x"] }), [mk("image", 10)]));
    expect(h.calls[0]!.url).toBe("https://graph.facebook.com/v27.0/u1/media");
    expect(h.calls[0]!.body).toEqual({ image_url: "https://r2.example/obj", caption: "Hello\n\n#x" });
    expect(h.calls[0]!.headers.authorization).toBe("Bearer TOKEN");
    expect(h.calls.find((c) => c.url.endsWith("media_publish"))!.body).toEqual({ creation_id: "CON1" });
    expect(r).toMatchObject({ externalId: "MEDIA1", url: "https://instagram.com/p/abc" });
  });
  it("publishes a video as a Reel and an image set as a carousel", async () => {
    const h = harness((c) => c.url.includes("status_code") ? Response.json({ status_code: "FINISHED" }) : c.url.endsWith("media_publish") ? Response.json({ id: "M" }) : c.url.includes("fields=permalink") ? new Response(null, { status: 500 }) : Response.json({ id: `C${Math.random()}` }));
    await ad(h.f).publish!(input(content(), [mk("video", 10)]));
    expect(h.calls[0]!.body).toMatchObject({ video_url: "https://r2.example/obj", media_type: "REELS" });
    const h2 = harness((c) => c.url.includes("status_code") ? Response.json({ status_code: "FINISHED" }) : c.url.endsWith("media_publish") ? Response.json({ id: "M" }) : Response.json({ id: `C${Math.random()}` }));
    const r = await ad(h2.f).publish!(input(content(), [mk("image", 10), mk("image", 10)]));
    expect(h2.calls.filter((c) => (c.body as { is_carousel_item?: boolean })?.is_carousel_item)).toHaveLength(2);
    expect(h2.calls.find((c) => (c.body as { media_type?: string })?.media_type === "CAROUSEL")!.body).toMatchObject({ children: expect.stringContaining(",") });
    expect(r.externalId).toBe("M");                              // a failing permalink lookup never fails a successful publish
  });
  it("container ERROR is permanent; ambiguity on media_publish is unknown; pre-publish 5xx is retryable", async () => {
    const run = (route: (c: Call) => Response) => ad(harness(route).f).publish!(input(content(), [mk("image", 10)])).catch((e) => e);
    expect(await run((c) => c.url.includes("status_code") ? Response.json({ status_code: "ERROR" }) : Response.json({ id: "C" }))).toMatchObject({ kind: "permanent" });
    expect(await run((c) => c.url.includes("status_code") ? Response.json({ status_code: "FINISHED" }) : c.url.endsWith("media_publish") ? new Response("x", { status: 502 }) : Response.json({ id: "C" }))).toMatchObject({ kind: "unknown" });
    expect(await run((c) => c.url.endsWith("/media") ? new Response("x", { status: 500 }) : Response.json({}))).toMatchObject({ kind: "retryable" });
    expect(await run(() => new Response("x", { status: 429 }))).toMatchObject({ kind: "rate_limited" });
  });
  it("Graph error 190 is auth_expired (account shows needs_reauth); Graph rate-limit codes are rate_limited", async () => {
    const run = (code: number) => ad(harness(() => Response.json({ error: { code, message: "x" } }, { status: 400 })).f).publish!(input(content(), [mk("image", 10)])).catch((e) => e);
    expect(await run(190)).toMatchObject({ kind: "auth_expired" });
    expect(await run(4)).toMatchObject({ kind: "rate_limited" });
  });
  it("reconciles by recent media caption", async () => {
    const h = harness(() => Response.json({ data: [{ id: "M7", caption: "Hello", timestamp: new Date().toISOString(), permalink: "https://instagram.com/p/z" }] }));
    expect(await ad(h.f).reconcile!({ accessToken: "T", account: { externalId: "u1", metadata: {} }, content: content(), idempotencyKey: "k", since: new Date(Date.now() - 60_000) })).toMatchObject({ externalId: "M7" });
  });
  it("carousel with a video child creates it as media_type VIDEO (not REELS) with is_carousel_item", async () => {
    const h = harness((c) => (c.url.includes("status_code") ? Response.json({ status_code: "FINISHED" }) : c.url.endsWith("media_publish") ? Response.json({ id: "M1" }) : Response.json({ id: `C${Math.random()}` })));
    await createInstagramAdapter({ appId: "a", appSecret: "s", pollMs: 1 } as never, h.f).publish!(input(content(), [mk("image", 10), mk("video", 10)]));
    const kids = h.calls.filter((c) => c.url.endsWith("/media") && (c.body as { is_carousel_item?: boolean }).is_carousel_item).map((c) => c.body as { media_type?: string; video_url?: string });
    expect(kids).toHaveLength(2);
    expect(kids.find((k) => k.video_url)?.media_type).toBe("VIDEO");
  });
  it("account insights: day metrics via metric_type=total_value (fallback one by one on 400, followers never lost); audience parses breakdowns and reports refusals", async () => {
    const ig = createInstagramAdapter({ clientId: "a", clientSecret: "s" } as never, harness(() => Response.json({})).f);
    expect(ig.fetchAudience).toBeDefined();
    const acct = { externalId: "17841", metadata: {} };
    let strict = true;
    const h = harness((c) => {
      if (c.url.includes("fields=followers_count")) return Response.json({ followers_count: 1234 });
      const metric = new URL(c.url).searchParams.get("metric")!;
      if (strict && metric.includes(",")) return new Response("bad", { status: 400 });              // one unsupported metric fails the grouped request
      if (metric === "views") return new Response("bad", { status: 400 });
      return Response.json({ data: [{ name: metric, period: "day", total_value: { value: metric === "reach" ? 321 : 7 } }] });
    });
    const a = createInstagramAdapter({ clientId: "a", clientSecret: "s" } as never, h.f);
    const r = await a.fetchAccountMetrics!({ accessToken: "T", account: acct });
    const by = Object.fromEntries(r.metrics.map((m) => [m.originalName, m]));
    expect(by.followers_count).toMatchObject({ value: 1234, availability: "available" });
    expect(h.calls[0]!.url).toBe("https://graph.facebook.com/v27.0/17841?fields=followers_count");   // a Page token's /me is the Page, not the IG account
    expect(by.reach).toMatchObject({ value: 321, period: "day", availability: "available" });
    expect(by.views).toMatchObject({ value: null, availability: "unavailable", period: "day" });     // refused: unavailable, not 0
    const groupedUrl = new URL(h.calls.find((c) => c.url.includes("/insights"))!.url);
    expect(groupedUrl.pathname).toContain("/17841/insights");
    expect(groupedUrl.searchParams.get("period")).toBe("day");
    expect(groupedUrl.searchParams.get("metric_type")).toBe("total_value");
    strict = false;
    const ha = harness((c) => {
      const u = new URL(c.url);
      if (u.searchParams.get("metric") === "engaged_audience_demographics") return new Response("<100 engagements", { status: 400 });
      if (u.searchParams.get("breakdown") === "city") return Response.json({ data: [{ total_value: { breakdowns: [{ results: [] }] } }] });
      return Response.json({ data: [{ name: "follower_demographics", total_value: { breakdowns: [{ dimension_keys: [u.searchParams.get("breakdown")], results: [{ dimension_values: ["F", "25-34"], value: 10 }, { dimension_values: ["M", "25-34"], value: 5 }] }] } }] });
    });
    const aud = await createInstagramAdapter({ clientId: "a", clientSecret: "s" } as never, ha.f).fetchAudience!({ accessToken: "T", account: acct });
    expect(aud.rows.map((x) => `${x.kind}/${x.breakdown}`)).toEqual(["follower/age", "follower/gender", "follower/country"]);
    expect(aud.rows[0]!.values).toEqual({ "F/25-34": 10, "M/25-34": 5 });
    expect(aud.unavailable["follower_demographics_city"]).toBeNull();                              // empty result = unavailable
    expect(aud.unavailable["engaged_audience_demographics_age"]).toBe(400);
    expect(new URL(ha.calls[0]!.url).searchParams.get("timeframe")).toBe("this_month");
  });
});
