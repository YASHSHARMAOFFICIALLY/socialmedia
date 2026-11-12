import { PlatformError } from "../core/errors.js";
import { apiFetch } from "../core/http.js";
import { chars, withHashtags } from "../core/rules.js";
import { NO_CAPABILITIES, NO_OAUTH, type MetricsResult, type SocialAdapter } from "../core/types.js";

// Verified (docs.joinmastodon.org): POST /api/v1/statuses (Idempotency-Key header, kept 1 hour; status, media_ids[], visibility);
// POST /api/v2/media (202 while processing -> poll GET /api/v1/media/:id, 206 until ready); GET /api/v1/accounts/verify_credentials;
// GET /api/v2/instance (configuration limits). Connection is credentials-mode: the user creates an app + access token in
// Preferences > Development on their own instance (scopes write:statuses write:media read:accounts), so no per-instance app registration.
interface Limits { maxChars: number; maxMedia: number; imageBytes: number; videoBytes: number }
const DEFAULT_LIMITS: Limits = { maxChars: 500, maxMedia: 4, imageBytes: 16_777_216, videoBytes: 103_809_024 };

/** Instance host from user input. https only, a real DNS name (no IP literal, port, credentials, localhost or internal suffix): this URL is fetched server-side. */
export function instanceOrigin(input: string): string {
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`); } catch { throw new PlatformError("permanent", "Invalid Mastodon instance address"); }
  const h = u.hostname.toLowerCase();
  const bad = u.protocol !== "https:" || u.port || u.username || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h) || /^[\d.]+$/.test(h) || /\.(local|internal|localhost|lan|home|corp)$/.test(h);
  if (bad) throw new PlatformError("permanent", "Mastodon instance must be a public https host name");
  return `https://${h}`;
}

const stripHtml = (s: string) => s.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>\s*<p>/gi, "\n\n").replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const norm = (s: string) => s.replace(/\s+/g, "");

export function createMastodonAdapter(cfg: { pollMs?: number } = {}, f: typeof fetch = fetch): SocialAdapter {
  const pollMs = cfg.pollMs ?? 2000;
  const auth = (t: string) => ({ authorization: `Bearer ${t}` });
  const origin = (account: { metadata: Record<string, unknown> }) => instanceOrigin(String(account.metadata.instance ?? ""));
  const limitsOf = (account: { metadata: Record<string, unknown> }): Limits => ({ ...DEFAULT_LIMITS, ...((account.metadata.limits as Partial<Limits> | undefined) ?? {}) });

  async function verify(base: string, token: string) {
    const res = await apiFetch(f, "mastodon", `${base}/api/v1/accounts/verify_credentials`, { headers: auth(token) });
    const a = (await res.json()) as { id?: string; username?: string; acct?: string; display_name?: string; avatar?: string; bot?: boolean; followers_count?: number };
    if (!a.id) throw new PlatformError("permanent", "mastodon verify_credentials returned no account");
    return a;
  }

  return {
    platform: "mastodon",
    capabilities: { ...NO_CAPABILITIES, textPost: true, imagePost: true, videoPost: true, lookupRecentPosts: true, postAnalytics: true, accountAnalytics: true, engagementMetrics: true },
    oauth: NO_OAUTH,
    async fetchAccount(): Promise<never> { throw new PlatformError("permanent", "mastodon accounts are connected with credentials"); },
    credentials: {
      fields: [
        { name: "instance", label: "Instance (e.g. mastodon.social)", secret: false },
        { name: "accessToken", label: "Access token", secret: true, help: "Instance > Preferences > Development > New application, scopes: read:accounts write:statuses write:media. Copy 'Your access token'." },
      ],
      async connect(fields) {
        const base = instanceOrigin(fields.instance!);
        const token = fields.accessToken!.trim();
        const a = await verify(base, token);
        let limits = DEFAULT_LIMITS;
        try {
          const i = (await (await apiFetch(f, "mastodon", `${base}/api/v2/instance`, {})).json()) as { configuration?: { statuses?: { max_characters?: number; max_media_attachments?: number }; media_attachments?: { image_size_limit?: number; video_size_limit?: number } } };
          const c = i.configuration;
          limits = { maxChars: c?.statuses?.max_characters ?? limits.maxChars, maxMedia: c?.statuses?.max_media_attachments ?? limits.maxMedia, imageBytes: c?.media_attachments?.image_size_limit ?? limits.imageBytes, videoBytes: c?.media_attachments?.video_size_limit ?? limits.videoBytes };
        } catch { /* instance limits are best-effort: defaults apply */ }
        const host = new URL(base).host;
        return {
          profile: { externalId: `${host}:${a.id}`, displayName: a.display_name || a.username || a.acct || "Mastodon account", ...(a.acct ? { username: `${a.acct.split("@")[0]}@${host}` } : {}), ...(a.avatar ? { avatarUrl: a.avatar } : {}), accountType: "personal", metadata: { instance: base, accountId: a.id, limits } },
          tokens: { accessToken: token, scopes: ["read:accounts", "write:statuses", "write:media"] }, // Mastodon tokens do not expire
        };
      },
    },
    async publish({ accessToken, account, content, media, idempotencyKey, signal }) {
      const base = origin(account), lim = limitsOf(account);
      const text = withHashtags(content);
      if (chars(text) > lim.maxChars) throw new PlatformError("permanent", `Text exceeds this instance's ${lim.maxChars}-character limit`);
      if (media.length > lim.maxMedia) throw new PlatformError("permanent", `This instance allows ${lim.maxMedia} attachments`);
      const ids: string[] = [];
      for (const m of media.filter((x) => x.role === "media")) {
        if (m.sizeBytes > (m.kind === "image" ? lim.imageBytes : lim.videoBytes)) throw new PlatformError("permanent", `${m.kind} exceeds this instance's size limit`);
        const src = await f(await m.url(), { signal });
        if (!src.ok) throw new PlatformError("retryable", `Could not read media from storage (${src.status})`);
        const form = new FormData();
        form.set("file", new Blob([await src.arrayBuffer()], { type: m.mimeType }), `media.${m.mimeType.split("/")[1] ?? "bin"}`);
        if (content.metadata.altText) form.set("description", String(content.metadata.altText).slice(0, 1500));
        const up = await apiFetch(f, "mastodon", `${base}/api/v2/media`, { method: "POST", headers: auth(accessToken), body: form, signal });
        const att = (await up.json()) as { id: string };
        if (up.status === 202) await waitReady(base, accessToken, att.id, signal);
        ids.push(att.id);
      }
      const res = await apiFetch(f, "mastodon", `${base}/api/v1/statuses`, {
        method: "POST", headers: { ...auth(accessToken), "content-type": "application/json", "idempotency-key": idempotencyKey }, signal,
        body: JSON.stringify({ status: text, visibility: content.metadata.visibility ?? "public", ...(ids.length ? { media_ids: ids } : {}) }),
      }, { creates: true });
      const s = (await res.json()) as { id: string; url?: string };
      return { externalId: s.id, ...(s.url ? { url: s.url } : {}), raw: s };
    },
    async reconcile({ accessToken, account, content, since }) {
      const base = origin(account);
      const res = await apiFetch(f, "mastodon", `${base}/api/v1/accounts/${account.metadata.accountId}/statuses?limit=20`, { headers: auth(accessToken) });
      const want = norm(withHashtags(content));
      const hit = ((await res.json()) as { id: string; url?: string; content: string; created_at: string }[]).find((s) => new Date(s.created_at) >= since && norm(stripHtml(s.content)) === want);
      return hit ? { externalId: hit.id, ...(hit.url ? { url: hit.url } : {}) } : null;
    },
    async fetchPostMetrics({ accessToken, account, externalPostId }) {
      const res = await apiFetch(f, "mastodon", `${origin(account)}/api/v1/statuses/${externalPostId}`, { headers: auth(accessToken) });
      const raw = (await res.json()) as Record<string, unknown>;
      return metrics("statuses", raw, ["favourites_count", "reblogs_count", "replies_count"]);
    },
    async fetchAccountMetrics({ accessToken, account }) {
      const a = await verify(origin(account), accessToken);
      return metrics("verify_credentials", a, ["followers_count"]);
    },
  };

  async function waitReady(base: string, token: string, id: string, signal: AbortSignal) {
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, pollMs));
      const r = await apiFetch(f, "mastodon", `${base}/api/v1/media/${id}`, { headers: auth(token), signal });
      if (r.status === 200) return;
    }
    throw new PlatformError("retryable", "mastodon media still processing");
  }
}

function metrics(source: string, raw: unknown, names: string[]): MetricsResult {
  const o = raw as Record<string, unknown>;
  return { source, raw, metrics: names.map((n) => (typeof o[n] === "number" ? { originalName: n, value: o[n] as number, availability: "available" as const } : { originalName: n, value: null, availability: "unavailable" as const })) };
}
