import { PlatformError } from "../core/errors.js";
import { apiFetch } from "../core/http.js";
import { withHashtags } from "../core/rules.js";
import { NO_CAPABILITIES, NO_OAUTH, type MetricsResult, type OAuthTokens, type SocialAdapter } from "../core/types.js";
import { graphemes } from "./bluesky.rules.js";

// Verified (atproto lexicons): com.atproto.server.createSession {identifier,password} -> {accessJwt,refreshJwt,handle,did};
// refreshSession (Authorization: Bearer <refreshJwt>) -> new pair; com.atproto.repo.createRecord {repo,collection,rkey?,record};
// uploadBlob (raw bytes) -> {blob}; app.bsky.feed.getPosts?uris= -> postView {likeCount,repostCount,replyCount,quoteCount,bookmarkCount};
// app.bsky.actor.getProfile -> followersCount. Auth is an APP PASSWORD (Bluesky Settings), never the account password.
// A caller-chosen rkey makes createRecord idempotent per job and lets us look the post up exactly (getRecord) after an unknown outcome.
export const PUBLIC_APPVIEW = "https://public.api.bsky.app";
const classify = (_s: number, b: unknown) => ((b as { error?: string } | null)?.error === "ExpiredToken" || (b as { error?: string } | null)?.error === "InvalidToken" ? "auth_expired" as const : undefined);
const jwtExp = (jwt: string): Date | undefined => {
  try { const exp = (JSON.parse(atob(jwt.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: number }).exp; return exp ? new Date(exp * 1000) : undefined; } catch { return undefined; }
};
const rkeyOf = (key: string) => key.replace(/[^A-Za-z0-9._:~-]/g, "").slice(0, 100) || "post";

interface Session { accessJwt: string; refreshJwt: string; handle: string; did: string }
const tokensOf = (s: Session): OAuthTokens => ({ accessToken: s.accessJwt, refreshToken: s.refreshJwt, ...(jwtExp(s.accessJwt) ? { expiresAt: jwtExp(s.accessJwt)! } : {}), scopes: ["atproto"] });

const enc = new TextEncoder();
/** Facets (links, hashtags) use UTF-8 BYTE offsets. */
export function facets(text: string) {
  const out: unknown[] = [];
  const at = (i: number) => enc.encode(text.slice(0, i)).length;
  for (const m of text.matchAll(/https?:\/\/[^\s]+/g)) {
    const uri = m[0].replace(/[.,;:!?)\]]+$/, "");
    out.push({ index: { byteStart: at(m.index!), byteEnd: at(m.index! + uri.length) }, features: [{ $type: "app.bsky.richtext.facet#link", uri }] });
  }
  for (const m of text.matchAll(/(^|\s)#([^\s#.,;:!?]+)/g)) {
    const start = m.index! + m[1]!.length;
    out.push({ index: { byteStart: at(start), byteEnd: at(start + 1 + m[2]!.length) }, features: [{ $type: "app.bsky.richtext.facet#tag", tag: m[2] }] });
  }
  return out;
}

export function createBlueskyAdapter(cfg: { service?: string } = {}, f: typeof fetch = fetch): SocialAdapter {
  const base = (cfg.service ?? "https://bsky.social").replace(/\/$/, "");
  const x = (path: string) => `${base}/xrpc/${path}`;
  const json = (token: string) => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });

  return {
    platform: "bluesky",
    capabilities: { ...NO_CAPABILITIES, textPost: true, imagePost: true, tokenRefresh: true, lookupRecentPosts: true, postAnalytics: true, accountAnalytics: true, engagementMetrics: true },
    oauth: {
      ...NO_OAUTH,
      async refresh(refreshJwt) {
        const res = await apiFetch(f, "bluesky", x("com.atproto.server.refreshSession"), { method: "POST", headers: { authorization: `Bearer ${refreshJwt}` } }, { classify: (_s, b) => ((b as { error?: string } | null)?.error === "ExpiredToken" || (b as { error?: string } | null)?.error === "InvalidToken" ? "permanent" : undefined) });
        const s = (await res.json()) as Session;
        if (!s.accessJwt) throw new PlatformError("permanent", "bluesky refreshSession returned no session");
        return tokensOf(s);
      },
    },
    async fetchAccount(accessToken) {
      const res = await apiFetch(f, "bluesky", x("com.atproto.server.getSession"), { headers: { authorization: `Bearer ${accessToken}` } }, { classify });
      const s = (await res.json()) as { did?: string; handle?: string };
      if (!s.did) throw new PlatformError("permanent", "bluesky session has no did");
      return { externalId: s.did, displayName: s.handle ?? s.did, ...(s.handle ? { username: s.handle } : {}), accountType: "personal", metadata: { did: s.did, handle: s.handle, service: base } };
    },
    credentials: {
      fields: [
        { name: "identifier", label: "Handle or email", secret: false },
        { name: "appPassword", label: "App password", secret: true, help: "Create one in Bluesky Settings > Privacy and security > App passwords. Never use your account password." },
      ],
      async connect(fields) {
        const res = await apiFetch(f, "bluesky", x("com.atproto.server.createSession"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier: fields.identifier, password: fields.appPassword }) });
        const s = (await res.json()) as Session;
        if (!s.accessJwt || !s.did) throw new PlatformError("permanent", "bluesky createSession returned no session");
        let avatarUrl: string | undefined, displayName = s.handle;
        const p = await fetch_(`${PUBLIC_APPVIEW}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(s.did)}`);
        if (p) { displayName = p.displayName || s.handle; avatarUrl = p.avatar; }
        return { profile: { externalId: s.did, displayName, username: s.handle, ...(avatarUrl ? { avatarUrl } : {}), accountType: "personal", metadata: { did: s.did, handle: s.handle, service: base } }, tokens: tokensOf(s) };
      },
    },
    async publish({ accessToken, account, content, media, idempotencyKey, signal }) {
      const text = withHashtags(content);
      if (graphemes(text) > 300) throw new PlatformError("permanent", "Text exceeds 300 graphemes");
      const images = media.filter((m) => m.role === "media");
      if (images.some((m) => m.kind !== "image")) throw new PlatformError("permanent", "Only images are supported");
      const embeds: unknown[] = [];
      for (const m of images) {
        const src = await f(await m.url(), { signal });
        if (!src.ok) throw new PlatformError("retryable", `Could not read media from storage (${src.status})`);
        const up = await apiFetch(f, "bluesky", x("com.atproto.repo.uploadBlob"), { method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": m.mimeType }, body: await src.arrayBuffer(), signal }, { classify });
        embeds.push({ alt: String(content.metadata.altText ?? ""), image: ((await up.json()) as { blob: unknown }).blob });
      }
      const rkey = rkeyOf(idempotencyKey);
      const record = { $type: "app.bsky.feed.post", text, createdAt: new Date().toISOString(), ...(facets(text).length ? { facets: facets(text) } : {}), ...(embeds.length ? { embed: { $type: "app.bsky.embed.images", images: embeds } } : {}) };
      const did = account.externalId;
      try {
        const res = await apiFetch(f, "bluesky", x("com.atproto.repo.createRecord"), { method: "POST", headers: json(accessToken), body: JSON.stringify({ repo: did, collection: "app.bsky.feed.post", rkey, record }), signal }, { creates: true, classify });
        const r = (await res.json()) as { uri: string };
        return { externalId: r.uri, ...opt(postUrl(r.uri, account.metadata.handle)), raw: r };
      } catch (e) {
        // A resend of the same job (same rkey) can only fail with 400 when the record already exists: that is success.
        if (e instanceof PlatformError && e.kind === "permanent" && e.opts.status === 400) {
          const existing = await getRecord(accessToken, did, rkey).catch(() => null); // the original error always wins over a failed lookup
          if (existing) return existing;
        }
        throw e;
      }
    },
    async reconcile({ accessToken, account, idempotencyKey }) {
      return getRecord(accessToken, account.externalId, rkeyOf(idempotencyKey));
    },
    async fetchPostMetrics({ externalPostId }) {
      const res = await apiFetch(f, "bluesky", `${PUBLIC_APPVIEW}/xrpc/app.bsky.feed.getPosts?${new URLSearchParams({ uris: externalPostId })}`);
      const raw = (await res.json()) as { posts?: Record<string, unknown>[] };
      const p = raw.posts?.[0];
      return result("getPosts", raw, p, ["likeCount", "repostCount", "replyCount", "quoteCount", "bookmarkCount"]);
    },
    async fetchAccountMetrics({ account }) {
      const res = await apiFetch(f, "bluesky", `${PUBLIC_APPVIEW}/xrpc/app.bsky.actor.getProfile?${new URLSearchParams({ actor: account.externalId })}`);
      const raw = (await res.json()) as Record<string, unknown>;
      return result("getProfile", raw, raw, ["followersCount"]);
    },
  };

  async function fetch_(url: string): Promise<{ displayName?: string; avatar?: string } | null> {
    try { const r = await f(url); return r.ok ? ((await r.json()) as { displayName?: string; avatar?: string }) : null; } catch { return null; }
  }
  async function getRecord(token: string, did: string, rkey: string) {
    const res = await f(x(`com.atproto.repo.getRecord?${new URLSearchParams({ repo: did, collection: "app.bsky.feed.post", rkey })}`), { headers: { authorization: `Bearer ${token}` } }).catch(() => null);
    if (!res) return null;
    if (res.ok) { const r = (await res.json()) as { uri: string }; return { externalId: r.uri, ...opt(postUrl(r.uri)), raw: r }; }
    if (res.status === 400 && ((await res.json().catch(() => null)) as { error?: string } | null)?.error === "RecordNotFound") return null;
    throw new PlatformError(res.status === 401 ? "auth_expired" : "unknown", `bluesky getRecord responded ${res.status}`, { status: res.status });
  }
}

const opt = (url?: string) => (url ? { url } : {});
const postUrl = (uri: string, handle?: unknown) => {
  const m = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/(.+)$/.exec(uri);
  return m ? `https://bsky.app/profile/${typeof handle === "string" ? handle : m[1]}/post/${m[2]}` : undefined;
};

/** Metrics the platform did not return are `unavailable`, never 0. */
function result(source: string, raw: unknown, obj: Record<string, unknown> | undefined, names: string[]): MetricsResult {
  return { source, raw, metrics: names.map((n) => { const v = obj?.[n]; return typeof v === "number" ? { originalName: n, value: v, availability: "available" as const } : { originalName: n, value: null, availability: "unavailable" as const }; }) };
}
