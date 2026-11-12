import { describe, it, expect } from "vitest";
import { createLinkedInAdapter } from "../../src/integrations/linkedin/linkedin.adapter.js";
import { buildCommentary, escapeLittleText } from "../../src/integrations/linkedin/linkedin.publisher.js";
import type { ContentInput } from "../../src/integrations/core/rules.js";
import type { PublishInput, ResolvedMedia } from "../../src/integrations/core/types.js";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
const content = (o: Partial<ContentInput> = {}): ContentInput => ({ text: "Hello", title: null, description: null, hashtags: [], media: [], metadata: {}, ...o });
const media = (kind: "image" | "video", size = 1000): ResolvedMedia => ({ id: "m1", kind, role: "media", mimeType: kind === "image" ? "image/jpeg" : "video/mp4", sizeBytes: size, storageKey: "k", url: async () => "https://r2.example/obj" });
const input = (c: ContentInput, m: ResolvedMedia[] = []): PublishInput => ({ accessToken: "TOKEN", account: { externalId: "abc", metadata: { urn: "urn:li:person:abc" } }, content: c, media: m, idempotencyKey: "pub:1", signal: new AbortController().signal });

function harness(route: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = (async (url: string | URL | Request, init: RequestInit = {}) => {
    const call: Call = { url: String(url), method: init.method ?? "GET", headers: Object.fromEntries(new Headers(init.headers).entries()), body: typeof init.body === "string" ? JSON.parse(init.body) : init.body };
    calls.push(call);
    return route(call);
  }) as typeof fetch;
  return { calls, adapter: createLinkedInAdapter({ clientId: "c", clientSecret: "s", pollMs: 1 }, f) };
}
const created = (id = "urn:li:share:123") => new Response(null, { status: 201, headers: { "x-restli-id": id } });

describe("LinkedIn little-text escaping", () => {
  it("escapes every documented reserved character", () => {
    expect(escapeLittleText("a|b{c}d@e[f]g(h)i<j>k#l\\m*n_o~p")).toBe("a\\|b\\{c\\}d\\@e\\[f\\]g\\(h\\)i\\<j\\>k\\#l\\\\m\\*n\\_o\\~p");
    expect(escapeLittleText("plain text, 100% fine!")).toBe("plain text, 100% fine!");
  });
  it("renders hashtags with the documented template", () => {
    expect(buildCommentary("Launch (v2)", ["news", "#ai"])).toBe("Launch \\(v2\\)\n\n{hashtag|\\#|news} {hashtag|\\#|ai}");
  });
});

describe("LinkedIn publishing (mocked API)", () => {
  it("creates a text post with the documented request shape and returns the URN from x-restli-id", async () => {
    const h = harness(() => created());
    const r = await h.adapter.publish!(input(content({ hashtags: ["x"] })));
    expect(h.calls).toHaveLength(1);
    const c = h.calls[0]!;
    expect(c.url).toBe("https://api.linkedin.com/rest/posts");
    expect(c.method).toBe("POST");
    expect(c.headers).toMatchObject({ authorization: "Bearer TOKEN", "linkedin-version": "202610", "x-restli-protocol-version": "2.0.0" });
    expect(c.body).toMatchObject({ author: "urn:li:person:abc", visibility: "PUBLIC", lifecycleState: "PUBLISHED", distribution: { feedDistribution: "MAIN_FEED" }, commentary: "Hello\n\n{hashtag|\\#|x}" });
    expect((c.body as Record<string, unknown>).content).toBeUndefined();
    expect(r).toMatchObject({ externalId: "urn:li:share:123", url: "https://www.linkedin.com/feed/update/urn:li:share:123/" });
  });

  it("uploads an image (PUT with bearer token) then references it", async () => {
    const h = harness((c) => {
      if (c.url.includes("images?action=initializeUpload")) return Response.json({ value: { uploadUrl: "https://www.linkedin.com/dms-uploads/x", image: "urn:li:image:IMG1" } });
      if (c.url === "https://r2.example/obj") return new Response(new Uint8Array([1, 2, 3]));
      if (c.url.startsWith("https://www.linkedin.com/dms-uploads")) return new Response(null, { status: 201 });
      return created();
    });
    await h.adapter.publish!(input(content(), [media("image")]));
    const urls = h.calls.map((c) => `${c.method} ${c.url.split("?")[0]}`);
    expect(urls).toEqual(["POST https://api.linkedin.com/rest/images", "GET https://r2.example/obj", "PUT https://www.linkedin.com/dms-uploads/x", "POST https://api.linkedin.com/rest/posts"]);
    expect(h.calls[0]!.body).toEqual({ initializeUploadRequest: { owner: "urn:li:person:abc" } });
    expect(h.calls[2]!.headers.authorization).toBe("Bearer TOKEN");
    expect((h.calls[3]!.body as { content: unknown }).content).toEqual({ media: { id: "urn:li:image:IMG1" } });
  });

  it("uses multiImage for several images", async () => {
    let n = 0;
    const h = harness((c) => {
      if (c.url.includes("initializeUpload")) return Response.json({ value: { uploadUrl: `https://www.linkedin.com/dms-uploads/${++n}`, image: `urn:li:image:I${n}` } });
      if (c.url === "https://r2.example/obj") return new Response(new Uint8Array([1]));
      if (c.method === "PUT") return new Response(null, { status: 201 });
      return created();
    });
    await h.adapter.publish!(input(content(), [media("image"), media("image")]));
    const post = h.calls.at(-1)!.body as { content: { multiImage: { images: { id: string }[] } } };
    expect(post.content.multiImage.images.map((i) => i.id).sort()).toEqual(["urn:li:image:I1", "urn:li:image:I2"]);
  });

  it("uploads a video in 4 MB ranged parts WITHOUT the bearer token on part uploads, finalizes with ETags, waits for AVAILABLE", async () => {
    const size = 5 * 1024 * 1024;
    let polls = 0;
    const h = harness((c) => {
      if (c.url.includes("videos?action=initializeUpload")) return Response.json({ value: { video: "urn:li:video:V1", uploadToken: "tok", uploadInstructions: [{ uploadUrl: "https://up/1", firstByte: 0, lastByte: 4194303 }, { uploadUrl: "https://up/2", firstByte: 4194304, lastByte: size - 1 }] } });
      if (c.url === "https://r2.example/obj") { const m = /bytes=(\d+)-(\d+)/.exec(c.headers.range ?? "")!; return new Response(new Uint8Array(Number(m[2]) - Number(m[1]) + 1), { status: 206 }); }
      if (c.method === "PUT") return new Response(null, { status: 200, headers: { etag: `"etag-${c.url.slice(-1)}"` } });
      if (c.url.includes("finalizeUpload")) return new Response(null, { status: 200 });
      if (c.url.includes("/rest/videos/")) return Response.json({ status: ++polls < 2 ? "PROCESSING" : "AVAILABLE" });
      return created("urn:li:share:vid");
    });
    const r = await h.adapter.publish!(input(content({ title: "My video" }), [media("video", size)]));
    expect(r.externalId).toBe("urn:li:share:vid");
    const puts = h.calls.filter((c) => c.method === "PUT");
    expect(puts).toHaveLength(2);
    expect(puts.every((p) => p.headers.authorization === undefined)).toBe(true);     // documented: video part uploads must not carry the token
    const fin = h.calls.find((c) => c.url.includes("finalizeUpload"))!.body as { finalizeUploadRequest: unknown };
    expect(fin.finalizeUploadRequest).toEqual({ video: "urn:li:video:V1", uploadToken: "tok", uploadedPartIds: ["etag-1", "etag-2"] });
    expect(polls).toBe(2);
    expect((h.calls.at(-1)!.body as { content: unknown }).content).toEqual({ media: { id: "urn:li:video:V1", title: "My video" } });
  });

  it("failed video processing is permanent; still-processing is retryable (nothing was posted either way)", async () => {
    const mk = (status: string) => harness((c) => {
      if (c.url.includes("initializeUpload")) return Response.json({ value: { video: "urn:li:video:V", uploadToken: "", uploadInstructions: [{ uploadUrl: "https://up/1", firstByte: 0, lastByte: 999 }] } });
      if (c.url === "https://r2.example/obj") return new Response(new Uint8Array(1000), { status: 206 });
      if (c.method === "PUT") return new Response(null, { headers: { etag: '"e"' } });
      if (c.url.includes("finalizeUpload")) return new Response(null);
      return Response.json({ status, processingFailureReason: "bad codec" });
    });
    const a = mk("PROCESSING_FAILED");
    expect(await a.adapter.publish!(input(content(), [media("video", 1000)])).catch((e) => e)).toMatchObject({ kind: "permanent" });
    expect(a.calls.some((c) => c.url.endsWith("/rest/posts"))).toBe(false);
  });

  it("classifies failures: pre-create errors are retryable/permanent; create-call ambiguity is UNKNOWN (never a blind retry)", async () => {
    const run = (route: (c: Call) => Response, m: ResolvedMedia[] = []) => harness(route).adapter.publish!(input(content(), m)).catch((e) => e);
    expect(await run(() => new Response("no", { status: 429, headers: { "retry-after": "60" } }))).toMatchObject({ kind: "rate_limited", opts: { retryAfterS: 60 } });
    expect(await run(() => new Response("bad", { status: 422 }))).toMatchObject({ kind: "permanent" });
    expect(await run(() => new Response("expired", { status: 401 }))).toMatchObject({ kind: "auth_expired" });
    expect(await run(() => new Response("gateway", { status: 502 }))).toMatchObject({ kind: "unknown" });           // create call, 5xx
    expect(await run(() => new Response(null, { status: 201 }))).toMatchObject({ kind: "unknown" });                // created but no id header
    const net = harness(() => { throw new Error("ECONNRESET"); });
    expect(await net.adapter.publish!(input(content())).catch((e) => e)).toMatchObject({ kind: "unknown" });
    // a 5xx while uploading the image happens BEFORE the create call, so it is a plain retryable error
    const up = await run((c) => (c.url.includes("initializeUpload") ? new Response("x", { status: 503 }) : created()), [media("image")]);
    expect(up).toMatchObject({ kind: "retryable" });
  });

  it("rejects unsupported combinations before touching the network", async () => {
    const h = harness(() => created());
    expect(await h.adapter.publish!(input(content(), [media("video"), media("image")])).catch((e) => e)).toMatchObject({ kind: "permanent" });
    expect(h.calls).toHaveLength(0);
  });
});
