import { describe, it, expect } from "vitest";
import { createLinkedInAdapter } from "../../src/integrations/linkedin/linkedin.adapter.js";
import { PlatformError } from "../../src/integrations/core/errors.js";

type Route = (url: string, init: RequestInit) => Response | Promise<Response>;
const mockFetch = (route: Route) => (async (url: string | URL | Request, init?: RequestInit) => route(String(url), init ?? {})) as typeof fetch;
const json = (b: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers });
const adapter = (route: Route) => createLinkedInAdapter({ clientId: "cid", clientSecret: "sec" }, mockFetch(route));

describe("linkedin adapter", () => {
  it("builds an authorization URL with state, redirect and posting scope", () => {
    const u = new URL(adapter(() => json({})).oauth.authorizationUrl({ state: "S", redirectUri: "https://api/cb" }));
    expect(u.origin + u.pathname).toBe("https://www.linkedin.com/oauth/v2/authorization");
    expect(u.searchParams.get("state")).toBe("S");
    expect(u.searchParams.get("client_id")).toBe("cid");
    expect(u.searchParams.get("redirect_uri")).toBe("https://api/cb");
    expect(u.searchParams.get("scope")).toContain("w_member_social");
  });
  it("exchanges a code (secret sent in the body, not the URL) and parses tokens/scopes/expiry", async () => {
    let body = "";
    const a = adapter(async (url, init) => { body = String(init.body); expect(url).not.toContain("sec"); return json({ access_token: "AT", expires_in: 5184000, scope: "openid,profile,w_member_social" }); });
    const before = Date.now();
    const t = await a.oauth.exchangeCode({ code: "C", redirectUri: "https://api/cb" });
    expect(body).toContain("grant_type=authorization_code");
    expect(body).toContain("client_secret=sec");
    expect(t.accessToken).toBe("AT");
    expect(t.scopes).toEqual(["openid", "profile", "w_member_social"]);
    expect(t.expiresAt!.getTime()).toBeGreaterThanOrEqual(before + 5184000_000 - 1000);
    expect(t.refreshToken).toBeUndefined();
  });
  it("maps userinfo to an account profile", async () => {
    const a = adapter(() => json({ sub: "abc123", name: "Ada L", picture: "https://img/x.png", email: "ada@x.com" }));
    expect(await a.fetchAccount("AT")).toMatchObject({ externalId: "abc123", displayName: "Ada L", accountType: "personal", metadata: { urn: "urn:li:person:abc123" } });
  });
  it("declares only the capabilities that are implemented and verified", () => {
    expect(adapter(() => json({})).capabilities).toMatchObject({ textPost: true, imagePost: true, videoPost: true, carousel: false, reel: false, nativeScheduling: false, accountAnalytics: false, postAnalytics: false, tokenRefresh: false, lookupRecentPosts: false });
  });
  it.each([
    [401, "auth_expired"], [429, "rate_limited"], [500, "retryable"], [503, "retryable"], [400, "permanent"], [403, "permanent"],
  ])("classifies HTTP %i as %s", async (status, kind) => {
    const a = adapter(() => json({ message: "no" }, status, status === 429 ? { "retry-after": "42" } : {}));
    const e = await a.fetchAccount("AT").catch((x) => x);
    expect(e).toBeInstanceOf(PlatformError);
    expect(e.kind).toBe(kind);
    if (status === 429) expect(e.opts.retryAfterS).toBe(42);
  });
  it("treats network failures as retryable", async () => {
    const a = createLinkedInAdapter({ clientId: "c", clientSecret: "s" }, (async () => { throw new Error("ECONNRESET"); }) as typeof fetch);
    expect((await a.fetchAccount("AT").catch((x) => x)).kind).toBe("retryable");
  });
});
