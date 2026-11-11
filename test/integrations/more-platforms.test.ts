import { describe, it, expect } from "vitest";
import { createBlueskyAdapter, facets } from "../../src/integrations/bluesky/bluesky.adapter.js";
import { createMastodonAdapter, instanceOrigin } from "../../src/integrations/mastodon/mastodon.adapter.js";
import { createTelegramAdapter } from "../../src/integrations/telegram/telegram.adapter.js";
import { createThreadsAdapter } from "../../src/integrations/threads/threads.adapter.js";
import { createFacebookAdapter } from "../../src/integrations/facebook/facebook.adapter.js";
import { createPinterestAdapter } from "../../src/integrations/pinterest/pinterest.adapter.js";
import { createTikTokAdapter } from "../../src/integrations/tiktok/tiktok.adapter.js";
import { contentRules } from "../../src/integrations/rules.js";
import { PlatformError } from "../../src/integrations/core/errors.js";
import type { ContentInput } from "../../src/integrations/core/rules.js";
import type { PublishInput, ResolvedMedia } from "../../src/integrations/core/types.js";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
const harness = (route: (c: Call) => Response | Promise<Response>) => {
  const calls: Call[] = [];
  const f = (async (url: string | URL | Request, init: RequestInit = {}) => {
    const body = typeof init.body === "string" ? (init.body.startsWith("{") ? JSON.parse(init.body) : init.body) : init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : init.body;
    const c: Call = { url: String(url), method: init.method ?? "GET", headers: Object.fromEntries(new Headers(init.headers).entries()), body };
    calls.push(c);
    return route(c);
  }) as typeof fetch;
  return { f, calls };
};
const content = (o: Partial<ContentInput> = {}): ContentInput => ({ text: "Hello", title: null, description: null, hashtags: [], media: [], metadata: {}, ...o });
const mk = (kind: "image" | "video", size = 1000): ResolvedMedia => ({ id: "m", kind, role: "media", mimeType: kind === "image" ? "image/jpeg" : "video/mp4", sizeBytes: size, storageKey: "k", url: async () => "https://r2.example/obj" });
const input = (c: ContentInput, m: ResolvedMedia[] = [], meta: Record<string, unknown> = {}, id = "acct1"): PublishInput => ({ accessToken: "TOKEN", account: { externalId: id, metadata: meta }, content: c, media: m, idempotencyKey: "job-1", signal: new AbortController().signal });
const mediaOf = (kind: "image" | "video", size = 1000) => ({ kind, role: "media" as const, mimeType: kind === "image" ? "image/jpeg" : "video/mp4", sizeBytes: size });
const errKind = async (p: Promise<unknown>) => (await p.then(() => null, (e) => e)) as PlatformError;

describe("Bluesky", () => {
  const jwt = (exp: number) => `x.${btoa(JSON.stringify({ exp })).replace(/=/g, "")}.y`;
  it("connects with an app password and stores the jwt pair with expiry", async () => {
    const exp = Math.floor(Date.now() / 1000) + 7200;
    const h = harness((c) => c.url.includes("createSession") ? Response.json({ accessJwt: jwt(exp), refreshJwt: "R", handle: "a.bsky.social", did: "did:plc:1" }) : Response.json({ displayName: "Ada" }));
    const r = await createBlueskyAdapter({}, h.f).credentials!.connect({ identifier: "a.bsky.social", appPassword: "pw" });
    expect(h.calls[0]).toMatchObject({ url: "https://bsky.social/xrpc/com.atproto.server.createSession", body: { identifier: "a.bsky.social", password: "pw" } });
    expect(r.profile).toMatchObject({ externalId: "did:plc:1", displayName: "Ada", username: "a.bsky.social" });
    expect(r.tokens.refreshToken).toBe("R");
    expect(r.tokens.expiresAt?.getTime()).toBe(exp * 1000);
  });
  it("refreshes via refreshSession with the refresh jwt as bearer", async () => {
    const h = harness(() => Response.json({ accessJwt: jwt(9999999999), refreshJwt: "R2", handle: "h", did: "d" }));
    const t = await createBlueskyAdapter({}, h.f).oauth.refresh!("OLDREFRESH");
    expect(h.calls[0]!.headers.authorization).toBe("Bearer OLDREFRESH");
    expect(t.refreshToken).toBe("R2");
  });
  it("publishes with a deterministic rkey, byte-offset facets and uploaded image blobs", async () => {
    const h = harness((c) => c.url.includes("uploadBlob") ? Response.json({ blob: { ref: "b" } }) : c.url.includes("createRecord") ? Response.json({ uri: "at://did:plc:1/app.bsky.feed.post/job-1", cid: "c" }) : new Response(new Uint8Array(5)));
    const r = await createBlueskyAdapter({}, h.f).publish!(input(content({ text: "é https://x.com/a. ", hashtags: ["ai"] }), [mk("image")], { handle: "a.bsky.social" }, "did:plc:1"));
    const create = h.calls.find((c) => c.url.includes("createRecord"))!;
    const body = create.body as { rkey: string; repo: string; record: { text: string; facets: { index: { byteStart: number }; features: { $type: string }[] }[]; embed: { images: unknown[] } } };
    expect(body).toMatchObject({ rkey: "job-1", repo: "did:plc:1" });
    expect(body.record.embed.images).toHaveLength(1);
    expect(r).toMatchObject({ externalId: "at://did:plc:1/app.bsky.feed.post/job-1", url: "https://bsky.app/profile/a.bsky.social/post/job-1" });
    // "é " = 3 bytes so the link starts at byte 3, not char 2
    expect(facets("é https://x.com/a. #ai")[0]).toMatchObject({ index: { byteStart: 3, byteEnd: 3 + 15 } });
    expect(body.record.facets.some((x) => x.features[0]!.$type.endsWith("#tag"))).toBe(true);
  });
  it("a resend whose record already exists (400) resolves to success via getRecord", async () => {
    const h = harness((c) => c.url.includes("createRecord") ? Response.json({ error: "InvalidRequest" }, { status: 400 }) : Response.json({ uri: "at://did:plc:1/app.bsky.feed.post/job-1" }));
    expect((await createBlueskyAdapter({}, h.f).publish!(input(content(), [], {}, "did:plc:1"))).externalId).toBe("at://did:plc:1/app.bsky.feed.post/job-1");
  });
  it("classifies ExpiredToken as auth_expired and a 5xx on createRecord as unknown", async () => {
    const a = createBlueskyAdapter({}, harness(() => Response.json({ error: "ExpiredToken" }, { status: 400 })).f);
    expect((await errKind(a.publish!(input(content()))))?.kind).toBe("auth_expired");
    const b = createBlueskyAdapter({}, harness((c) => c.url.includes("getRecord") ? Response.json({ error: "RecordNotFound" }, { status: 400 }) : new Response("", { status: 502 })).f);
    expect((await errKind(b.publish!(input(content()))))?.kind).toBe("unknown");
  });
  it("reconcile: null when RecordNotFound, result when found", async () => {
    const none = createBlueskyAdapter({}, harness(() => Response.json({ error: "RecordNotFound" }, { status: 400 })).f);
    expect(await none.reconcile!({ ...input(content()), since: new Date(0) })).toBeNull();
    const some = createBlueskyAdapter({}, harness(() => Response.json({ uri: "at://d/app.bsky.feed.post/job-1" })).f);
    expect((await some.reconcile!({ ...input(content()), since: new Date(0) }))?.externalId).toBe("at://d/app.bsky.feed.post/job-1");
  });
  it("metrics: reports unavailable (not 0) for fields the API omitted", async () => {
    const a = createBlueskyAdapter({}, harness(() => Response.json({ posts: [{ likeCount: 3, repostCount: 1 }] })).f);
    const m = await a.fetchPostMetrics!({ accessToken: "t", account: { externalId: "d", metadata: {} }, externalPostId: "at://x", publishedAt: new Date() });
    expect(m.metrics.find((x) => x.originalName === "likeCount")).toMatchObject({ value: 3, availability: "available" });
    expect(m.metrics.find((x) => x.originalName === "replyCount")).toMatchObject({ value: null, availability: "unavailable" });
  });
  it("rules: 300 graphemes counted by grapheme, video rejected, 5 images rejected", () => {
    const r = contentRules.bluesky;
    expect(r.validate({ ...content({ text: "👨‍👩‍👧".repeat(300) }) }).some((i) => i.code === "TEXT_LONG")).toBe(false);
    expect(r.validate(content({ text: "a".repeat(301) })).some((i) => i.code === "TEXT_LONG")).toBe(true);
    expect(r.validate(content({ media: [mediaOf("video")] })).some((i) => i.code === "VIDEO_UNSUPPORTED")).toBe(true);
    expect(r.validate(content({ media: Array(5).fill(mediaOf("image")) })).some((i) => i.code === "TOO_MANY_IMAGES")).toBe(true);
  });
});

describe("Mastodon", () => {
  it("only accepts public https host names (the URL is fetched server-side)", () => {
    expect(instanceOrigin("mastodon.social")).toBe("https://mastodon.social");
    for (const bad of ["http://mastodon.social", "https://127.0.0.1", "https://10.0.0.1", "https://localhost", "https://a.internal", "https://u:p@x.social", "https://x.social:8443", "not a host"]) expect(() => instanceOrigin(bad), bad).toThrow(PlatformError);
  });
  const mastoAccount = { instance: "https://m.social", accountId: "7", limits: { maxChars: 10 } };
  it("connects: verify_credentials + instance limits stored in metadata", async () => {
    const h = harness((c) => c.url.endsWith("verify_credentials") ? Response.json({ id: "7", acct: "ada", display_name: "Ada" }) : Response.json({ configuration: { statuses: { max_characters: 300, max_media_attachments: 2 } } }));
    const r = await createMastodonAdapter({}, h.f).credentials!.connect({ instance: "m.social", accessToken: "TK" });
    expect(h.calls[0]!.headers.authorization).toBe("Bearer TK");
    expect(r.profile).toMatchObject({ externalId: "m.social:7", username: "ada@m.social" });
    expect((r.profile.metadata as { limits: { maxChars: number } }).limits.maxChars).toBe(300);
  });
  it("publishes with Idempotency-Key and the instance's own character limit", async () => {
    const h = harness(() => Response.json({ id: "55", url: "https://m.social/@ada/55" }));
    const a = createMastodonAdapter({}, h.f);
    expect((await errKind(a.publish!(input(content({ text: "this is far too long" }), [], mastoAccount))))?.kind).toBe("permanent");
    const r = await a.publish!(input(content({ text: "short" }), [], { ...mastoAccount, limits: { maxChars: 500 } }));
    expect(h.calls[0]).toMatchObject({ url: "https://m.social/api/v1/statuses", headers: { "idempotency-key": "job-1" }, body: { status: "short", visibility: "public" } });
    expect(r.externalId).toBe("55");
  });
  it("uploads media (202 -> polls until 200) then attaches media_ids", async () => {
    let polls = 0;
    const h = harness((c) => c.url.endsWith("/api/v2/media") ? Response.json({ id: "M1" }, { status: 202 }) : c.url.includes("/api/v1/media/") ? new Response("{}", { status: ++polls < 2 ? 206 : 200 }) : c.url.includes("statuses") ? Response.json({ id: "9" }) : new Response(new Uint8Array(4)));
    await createMastodonAdapter({ pollMs: 1 }, h.f).publish!(input(content(), [mk("image")], { ...mastoAccount, limits: {} }));
    expect(polls).toBe(2);
    expect((h.calls.at(-1)!.body as { media_ids: string[] }).media_ids).toEqual(["M1"]);
  });
  it("401 is auth_expired; reconcile matches stripped html content after `since`", async () => {
    expect((await errKind(createMastodonAdapter({}, harness(() => new Response("{}", { status: 401 })).f).publish!(input(content(), [], mastoAccount))))?.kind).toBe("auth_expired");
    const a = createMastodonAdapter({}, harness(() => Response.json([{ id: "1", content: "<p>Hi &amp; bye</p>", created_at: new Date().toISOString() }])).f);
    expect((await a.reconcile!({ ...input(content({ text: "Hi & bye" }), [], mastoAccount), since: new Date(Date.now() - 1000) }))?.externalId).toBe("1");
  });
});

describe("Telegram", () => {
  const tg = (f: typeof fetch) => createTelegramAdapter(f);
  it("connect validates bot, channel and admin rights", async () => {
    const route = (admin: string) => (c: Call) => Response.json({ ok: true, result: c.url.endsWith("getMe") ? { id: 9, username: "bot" } : c.url.endsWith("getChat") ? { id: -100123, type: "channel", title: "News", username: "news" } : { status: admin, can_post_messages: true } });
    const r = await tg(harness(route("administrator")).f).credentials!.connect({ botToken: "123:abc", chat: "@news" });
    expect(r.profile).toMatchObject({ externalId: "-100123", displayName: "News", accountType: "channel" });
    expect(r.tokens.accessToken).toBe("123:abc");
    expect((await errKind(tg(harness(route("member")).f).credentials!.connect({ botToken: "t", chat: "@n" })))?.kind).toBe("permanent");
  });
  it("sends text, photo+caption and video; 429 carries retry_after; 401 is auth_expired", async () => {
    const h = harness(() => Response.json({ ok: true, result: { message_id: 5, chat: { username: "news" } } }));
    const a = tg(h.f);
    expect((await a.publish!(input(content({ text: "hi", hashtags: ["x"] }), [], {}, "-100"))).url).toBe("https://t.me/news/5");
    expect(h.calls[0]).toMatchObject({ url: "https://api.telegram.org/botTOKEN/sendMessage", body: { chat_id: "-100", text: "hi\n\n#x" } });
    await a.publish!(input(content(), [mk("image")], {}, "-100"));
    expect(h.calls[1]).toMatchObject({ url: expect.stringContaining("sendPhoto"), body: { photo: "https://r2.example/obj" } });
    await a.publish!(input(content(), [mk("video")], {}, "-100"));
    expect(h.calls[2]!.url).toContain("sendVideo");
    const limited = await errKind(tg(harness(() => Response.json({ ok: false, error_code: 429, parameters: { retry_after: 7 } }, { status: 429 })).f).publish!(input(content())));
    expect(limited).toMatchObject({ kind: "rate_limited", opts: { retryAfterS: 7 } });
    expect((await errKind(tg(harness(() => Response.json({ ok: false }, { status: 401 })).f).publish!(input(content()))))?.kind).toBe("auth_expired");
  });
  it("album: one sendMediaGroup call, caption on the first item only, first message id returned", async () => {
    const h = harness(() => Response.json({ ok: true, result: [{ message_id: 7, chat: { username: "news" } }, { message_id: 8 }] }));
    const r = await tg(h.f).publish!(input(content({ text: "cap" }), [mk("image"), mk("video")], {}, "-100"));
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toMatchObject({ url: expect.stringContaining("sendMediaGroup"), body: { media: [{ type: "photo", caption: "cap" }, { type: "video" }] } });
    expect((h.calls[0]!.body as { media: { caption?: string }[] }).media[1]!.caption).toBeUndefined();
    expect(r).toMatchObject({ externalId: "7", url: "https://t.me/news/7" });
  });
  it("a 5xx on the creating call is unknown (never a blind resend)", async () => {
    expect((await errKind(tg(harness(() => new Response("", { status: 502 })).f).publish!(input(content()))))?.kind).toBe("unknown");
  });
  it("rules: 4096 text / 1024 caption, one media, size caps for URL sending; no reconcile claimed", () => {
    const r = contentRules.telegram;
    expect(r.validate(content({ text: "a".repeat(4097) })).some((i) => i.code === "TEXT_LONG")).toBe(true);
    expect(r.validate(content({ text: "a".repeat(1025), media: [mediaOf("image")] })).some((i) => i.code === "TEXT_LONG")).toBe(true);
    expect(r.validate(content({ media: Array.from({ length: 11 }, () => mediaOf("image")) })).some((i) => i.code === "TOO_MANY_MEDIA")).toBe(true);
    expect(r.validate(content({ media: [mediaOf("image"), mediaOf("video")] })).some((i) => i.code === "TOO_MANY_MEDIA")).toBe(false);
    expect(r.validate(content({ media: [mediaOf("image", 6 * 1024 * 1024)] })).some((i) => i.code === "IMAGE_TOO_LARGE")).toBe(true);
    expect(tg(fetch).reconcile).toBeUndefined();
  });
  it("member count metric is a number or unavailable", async () => {
    const m = await tg(harness(() => Response.json({ ok: true, result: 1234 })).f).fetchAccountMetrics!({ accessToken: "t", account: { externalId: "-100", metadata: {} } });
    expect(m.metrics[0]).toMatchObject({ originalName: "member_count", value: 1234 });
  });
});

describe("Threads", () => {
  const ad = (f: typeof fetch) => createThreadsAdapter({ clientId: "cid", clientSecret: "sec", pollMs: 1 }, f);
  it("authorize URL, short->long token exchange, refresh", async () => {
    const h = harness((c) => c.url.includes("oauth/access_token") ? Response.json({ access_token: "SHORT", user_id: 1 }) : Response.json({ access_token: "LONG", expires_in: 5183944 }));
    const a = ad(h.f);
    const u = new URL(a.oauth.authorizationUrl({ state: "S", redirectUri: "https://api/cb" }));
    expect(u.origin + u.pathname).toBe("https://threads.com/oauth/authorize");
    expect(u.searchParams.get("scope")).toBe("threads_basic,threads_content_publish,threads_manage_insights");
    const t = await a.oauth.exchangeCode({ code: "C", redirectUri: "https://api/cb" });
    expect(h.calls[1]!.url).toContain("grant_type=th_exchange_token");
    expect(t).toMatchObject({ accessToken: "LONG", refreshToken: "LONG" });
    await a.oauth.refresh!("LONG");
    expect(h.calls[2]!.url).toContain("grant_type=th_refresh_token");
  });
  it("text post: container -> status FINISHED -> threads_publish", async () => {
    const h = harness((c) => c.url.endsWith("/threads") ? Response.json({ id: "C1" }) : c.url.includes("status") ? Response.json({ status: "FINISHED" }) : c.url.endsWith("threads_publish") ? Response.json({ id: "P1" }) : Response.json({ permalink: "https://threads.com/@a/post/P1" }));
    const r = await ad(h.f).publish!(input(content({ hashtags: ["ai"] })));
    expect(h.calls[0]).toMatchObject({ url: "https://graph.threads.com/v1.0/acct1/threads", body: { media_type: "TEXT", text: "Hello\n\n#ai" } });
    expect(h.calls.find((c) => c.url.endsWith("threads_publish"))!.body).toEqual({ creation_id: "C1" });
    expect(r).toMatchObject({ externalId: "P1", url: "https://threads.com/@a/post/P1" });
  });
  it("carousel: child containers flagged is_carousel_item, then CAROUSEL container", async () => {
    let n = 0;
    const h = harness((c) => c.url.endsWith("/threads") ? Response.json({ id: `C${++n}` }) : c.url.includes("status") ? Response.json({ status: "FINISHED" }) : Response.json({ id: "P" }));
    await ad(h.f).publish!(input(content(), [mk("image"), mk("video")]));
    const posts = h.calls.filter((c) => c.url.endsWith("/threads")).map((c) => c.body as Record<string, string>);
    expect(posts[0]).toMatchObject({ media_type: "IMAGE", is_carousel_item: "true" });
    expect(posts[1]).toMatchObject({ media_type: "VIDEO", is_carousel_item: "true" });
    expect(posts[2]).toMatchObject({ media_type: "CAROUSEL", children: "C1,C2" });
  });
  it("container ERROR is permanent; expired token (code 190) is auth_expired; publish 5xx is unknown", async () => {
    const e = await errKind(ad(harness((c) => c.url.endsWith("/threads") ? Response.json({ id: "C" }) : Response.json({ status: "ERROR" })).f).publish!(input(content())));
    expect(e.kind).toBe("permanent");
    expect((await errKind(ad(harness(() => Response.json({ error: { code: 190 } }, { status: 400 })).f).publish!(input(content()))))?.kind).toBe("auth_expired");
    const u = await errKind(ad(harness((c) => c.url.endsWith("/threads") ? Response.json({ id: "C" }) : c.url.includes("status") ? Response.json({ status: "FINISHED" }) : new Response("", { status: 500 })).f).publish!(input(content())));
    expect(u.kind).toBe("unknown");
  });
  it("rules count emoji by UTF-8 bytes (docs) and metrics are unavailable when absent", async () => {
    expect(contentRules.threads.validate(content({ text: "😀".repeat(126) })).some((i) => i.code === "TEXT_LONG")).toBe(true);
    expect(contentRules.threads.validate(content({ text: "😀".repeat(125) })).some((i) => i.code === "TEXT_LONG")).toBe(false);
    const m = await ad(harness(() => Response.json({ data: [{ name: "likes", values: [{ value: 4 }] }] })).f).fetchPostMetrics!({ accessToken: "t", account: { externalId: "u", metadata: {} }, externalPostId: "p", publishedAt: new Date() });
    expect(m.metrics.find((x) => x.originalName === "likes")?.value).toBe(4);
    expect(m.metrics.find((x) => x.originalName === "views")).toMatchObject({ value: null, availability: "unavailable" });
  });
});

describe("Facebook Pages", () => {
  const ad = (f: typeof fetch) => createFacebookAdapter({ clientId: "cid", clientSecret: "sec" }, f);
  it("exchanges for a long-lived user token, then lists each Page with its own Page token", async () => {
    const h = harness((c) => c.url.includes("oauth/access_token") ? Response.json({ access_token: c.url.includes("fb_exchange_token") ? "LONG" : "SHORT" }) : Response.json({ data: [{ id: "p1", name: "Shop", access_token: "PT1", picture: { data: { url: "https://pic" } } }, { id: "p2", name: "No token" }] }));
    const a = ad(h.f);
    const t = await a.oauth.exchangeCode({ code: "C", redirectUri: "https://api/cb" });
    expect(t.accessToken).toBe("LONG");
    const pages = await a.listAccounts!(t);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ profile: { externalId: "p1", displayName: "Shop" }, tokens: { accessToken: "PT1" } });
  });
  it("text -> /feed; one photo -> /photos(url); many photos -> unpublished uploads + attached_media; video -> /videos(file_url)", async () => {
    let n = 0;
    const h = harness((c) => Response.json({ id: c.url.endsWith("/photos") ? `ph${++n}` : "post1" }));
    const a = ad(h.f);
    await a.publish!(input(content({ hashtags: ["x"] })));
    expect(h.calls[0]).toMatchObject({ url: expect.stringMatching(/\/acct1\/feed$/), body: { message: "Hello\n\n#x" } });
    await a.publish!(input(content(), [mk("image")]));
    expect(h.calls[1]).toMatchObject({ url: expect.stringMatching(/\/acct1\/photos$/), body: { url: "https://r2.example/obj", published: "true", caption: "Hello" } });
    await a.publish!(input(content(), [mk("image"), mk("image")]));
    expect(h.calls[2]!.body).toMatchObject({ published: "false" });
    expect(h.calls[4]!.body).toMatchObject({ "attached_media[0]": JSON.stringify({ media_fbid: "ph2" }), "attached_media[1]": JSON.stringify({ media_fbid: "ph3" }) });
    await a.publish!(input(content(), [mk("video")]));
    expect(h.calls[5]).toMatchObject({ url: expect.stringMatching(/\/acct1\/videos$/), body: { file_url: "https://r2.example/obj", description: "Hello" } });
  });
  it("errors: 190 -> auth_expired, 5xx on create -> unknown; capabilities do not claim analytics", async () => {
    expect((await errKind(ad(harness(() => Response.json({ error: { code: 190 } }, { status: 400 })).f).publish!(input(content()))))?.kind).toBe("auth_expired");
    expect((await errKind(ad(harness(() => new Response("", { status: 503 })).f).publish!(input(content()))))?.kind).toBe("unknown");
    const a = ad(fetch);
    expect(a.capabilities).toMatchObject({ postAnalytics: false, accountAnalytics: false, tokenRefresh: false });
    expect(a.fetchPostMetrics).toBeUndefined();
  });
});

describe("Pinterest", () => {
  const ad = (f: typeof fetch) => createPinterestAdapter({ clientId: "cid", clientSecret: "sec" }, f);
  it("token exchange uses Basic auth + form body; refresh uses grant_type=refresh_token", async () => {
    const h = harness(() => Response.json({ access_token: "A", refresh_token: "R", expires_in: 3600, refresh_token_expires_in: 5184000, scope: "pins:write,boards:read" }));
    const t = await ad(h.f).oauth.exchangeCode({ code: "C", redirectUri: "https://api/cb" });
    expect(h.calls[0]).toMatchObject({ url: "https://api.pinterest.com/v5/oauth/token", body: { grant_type: "authorization_code", code: "C" } });
    expect(h.calls[0]!.headers.authorization).toBe(`Basic ${btoa("cid:sec")}`);
    expect(t).toMatchObject({ accessToken: "A", refreshToken: "R", scopes: ["pins:write", "boards:read"] });
    expect(t.refreshExpiresAt).toBeDefined();
    await ad(h.f).oauth.refresh!("R");
    expect(h.calls[1]!.body).toMatchObject({ grant_type: "refresh_token", refresh_token: "R" });
  });
  it("creates an image pin on the board; refuses without boardId or image", async () => {
    const h = harness(() => Response.json({ id: "123" }));
    const r = await ad(h.f).publish!(input(content({ title: "T", metadata: { boardId: "99", link: "https://x.com", altText: "alt" } }), [mk("image")]));
    expect(h.calls[0]!.body).toMatchObject({ board_id: "99", title: "T", link: "https://x.com", alt_text: "alt", media_source: { source_type: "image_url", url: "https://r2.example/obj" } });
    expect(r).toMatchObject({ externalId: "123", url: "https://www.pinterest.com/pin/123/" });
    expect((await errKind(ad(h.f).publish!(input(content(), [mk("image")]))))?.kind).toBe("permanent");
    expect((await errKind(ad(h.f).publish!(input(content({ metadata: { boardId: "99" } })))))?.kind).toBe("permanent");
  });
  it("rules enforce the spec limits and boardId", () => {
    const r = contentRules.pinterest;
    const codes = (c: ContentInput) => r.validate(c).map((i) => i.code);
    expect(codes(content({ media: [mediaOf("image")] }))).toContain("BOARD_REQUIRED");
    expect(codes(content({ title: "t".repeat(101), text: "d".repeat(801), metadata: { boardId: "1" }, media: [mediaOf("image")] }))).toEqual(expect.arrayContaining(["TITLE_LONG", "DESC_LONG"]));
    expect(codes(content({ metadata: { boardId: "1" }, media: [mediaOf("image")] }))).toEqual([]);
  });
});

describe("TikTok (endpoints per search-confirmed titles; shapes unverified)", () => {
  const ad = (f: typeof fetch) => createTikTokAdapter({ clientKey: "ck", clientSecret: "cs", pollMs: 1, maxPolls: 3 }, f);
  const route = (status: string) => (c: Call) => Response.json({ data: c.url.includes("creator_info") ? { privacy_level_options: ["SELF_ONLY", "PUBLIC_TO_EVERYONE"] } : c.url.includes("init") ? { publish_id: "pub1" } : { status, publicaly_available_post_id: [777] }, error: { code: "ok" } });
  it("refuses a privacy level the creator does not allow", async () => {
    expect((await errKind(ad(harness(route("PUBLISH_COMPLETE")).f).publish!(input(content({ metadata: { privacy: "FOLLOWERS" } }), [mk("video")]))))?.kind).toBe("permanent");
  });
  it("pulls the video from URL, polls to PUBLISH_COMPLETE and returns the public post id", async () => {
    const h = harness(route("PUBLISH_COMPLETE"));
    const r = await ad(h.f).publish!(input(content({ metadata: { privacy: "SELF_ONLY" } }), [mk("video")]));
    expect(h.calls.find((c) => c.url.includes("init"))!.body).toMatchObject({ source_info: { source: "PULL_FROM_URL", video_url: "https://r2.example/obj" }, post_info: { privacy_level: "SELF_ONLY" } });
    expect(r.externalId).toBe("777");
  });
  it("FAILED is permanent; still-processing returns the publish_id with a warning", async () => {
    expect((await errKind(ad(harness(route("FAILED")).f).publish!(input(content({ metadata: { privacy: "SELF_ONLY" } }), [mk("video")]))))?.kind).toBe("permanent");
    const r = await ad(harness(route("PROCESSING_DOWNLOAD")).f).publish!(input(content({ metadata: { privacy: "SELF_ONLY" } }), [mk("video")]));
    expect(r.externalId).toBe("pub1");
    expect(r.warnings?.length).toBe(1);
  });
});
