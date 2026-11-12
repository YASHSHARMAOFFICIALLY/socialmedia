import { z } from "zod";
import type { Db } from "../../infrastructure/database/db.js";
import type { Logger } from "../../infrastructure/logger/logger.js";
import { PlatformError } from "../../integrations/core/errors.js";
import type { AdapterRegistry } from "../../integrations/core/registry.js";
import type { PublicPost, PublicProfile } from "../../integrations/core/types.js";
import { AppError, badRequest, notFound } from "../../shared/errors/errors.js";
import type { AccountService } from "../accounts/account.service.js";
import { analyticsRepository } from "../analytics/analytics.repository.js";
import { defaultRange } from "../analytics/analytics.service.js";
import { median } from "../insights/insights.rules.js";
import type { Actor, WorkspaceService } from "../workspaces/workspace.service.js";

const INTERACTION_KEYS = ["likes", "comments", "reposts", "quotes"] as const;   // what is publicly visible on other people's posts
const MAX_PER_WORKSPACE = 10, POSTS_PER_COLLECTION = 30, FAILURE_LIMIT = 5;
/** Sum of the public interaction counts the platform actually provided; null when it provided none (never 0 by default). */
export const publicInteractions = (m: Record<string, number | null | undefined>) => {
  const present = INTERACTION_KEYS.map((k) => m[k]).filter((v): v is number => typeof v === "number");
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
};
const num = (s: string | number | null | undefined) => (s == null ? null : Number(s));

interface Row { id: string; platform: string; handle: string; external_id: string; display_name: string; avatar_url: string | null; status: string; failures: number; last_error: string | null; last_collected_at: string | null; created_at: string; uploads_playlist: string | null }

export function createCompetitorService(deps: { db: Db; workspaces: WorkspaceService; registry: AdapterRegistry; accounts: Pick<AccountService, "getAccessToken">; log: Logger }) {
  const { db, workspaces, registry } = deps;
  const view = (c: Row) => ({ id: c.id, platform: c.platform, handle: c.handle, displayName: c.display_name, avatarUrl: c.avatar_url, status: c.status, lastError: c.last_error, lastCollectedAt: c.last_collected_at, addedAt: c.created_at });
  const COLS = "id, platform, handle, external_id, display_name, avatar_url, status, failures, last_error, last_collected_at, created_at, extra_uploads AS uploads_playlist";

  async function tokenFor(workspaceId: string, platform: string) {
    const acct = (await db.query<{ id: string }>("SELECT id FROM social_accounts WHERE workspace_id = $1 AND platform = $2 AND status = 'active' ORDER BY created_at LIMIT 1", [workspaceId, platform])).rows[0];
    if (!acct) throw new AppError(409, "NEEDS_CONNECTED_ACCOUNT", `Connect a ${platform} account first: public data is read through your own connection`);
    return deps.accounts.getAccessToken(workspaceId, acct.id);
  }
  const mapError = (e: unknown): never => {
    if (e instanceof PlatformError) {
      if (e.kind === "permanent") throw new AppError(404, "COMPETITOR_NOT_FOUND", e.message);
      if (e.kind === "rate_limited") throw new AppError(429, "PLATFORM_RATE_LIMITED", "The platform rate limit was hit; try again later");
      if (e.kind === "auth_expired") throw new AppError(409, "NEEDS_REAUTH", "Reconnect your account and try again");
      throw new AppError(502, "PLATFORM_UNAVAILABLE", "The platform could not be reached");
    }
    throw e;
  };

  async function storeCollection(q: Pick<Db, "query">, c: { id: string; workspace_id: string }, profile: PublicProfile, posts: PublicPost[]) {
    await q.query("INSERT INTO competitor_snapshots (competitor_id, workspace_id, followers, posts_count, extra) VALUES ($1,$2,$3,$4,$5)", [c.id, c.workspace_id, profile.followers, profile.posts, JSON.stringify(profile.extra ?? {})]);
    for (const p of posts)
      await q.query("INSERT INTO competitor_posts (competitor_id, workspace_id, external_post_id, published_at, url, metrics) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (competitor_id, external_post_id) DO UPDATE SET metrics = EXCLUDED.metrics, updated_at = now()", [c.id, c.workspace_id, p.externalId, p.publishedAt.toISOString(), p.url ?? null, JSON.stringify(Object.fromEntries(Object.entries(p.metrics).filter(([, v]) => v !== null)))]);
  }

  /** Collects one competitor. Never throws; failures back off and eventually disable the competitor (own data is unaffected). */
  async function collect(id: string): Promise<"collected" | "skipped" | "failed"> {
    const c = (await db.query<Row & { workspace_id: string }>(
      `UPDATE competitors SET claim_until = now() + interval '10 minutes' WHERE id = $1 AND status = 'active' AND next_collect_at <= now() AND (claim_until IS NULL OR claim_until < now()) RETURNING ${COLS}, workspace_id`, [id])).rows[0];
    if (!c) return "skipped";
    try {
      const adapter = registry.get(c.platform);
      if (!adapter.lookupPublicProfile || !adapter.fetchPublicPosts) throw new PlatformError("permanent", "Platform does not support competitor lookup");
      const token = await tokenFor(c.workspace_id, c.platform);
      const profile = await adapter.lookupPublicProfile({ accessToken: token, handle: c.handle });
      const posts = await adapter.fetchPublicPosts({ accessToken: token, profile: { ...profile, ...(c.uploads_playlist ? { uploadsPlaylistId: c.uploads_playlist } : {}) }, limit: POSTS_PER_COLLECTION });
      await db.tx(async (q) => { await storeCollection(q, c, profile, posts); await q.query("UPDATE competitors SET next_collect_at = now() + interval '24 hours', claim_until = NULL, failures = 0, last_error = NULL, last_collected_at = now(), display_name = $2, avatar_url = $3 WHERE id = $1", [c.id, profile.displayName, profile.avatarUrl ?? null]); });
      return "collected";
    } catch (e) {
      const pe = e instanceof PlatformError ? e : null, f = c.failures + 1;
      const delayS = pe?.kind === "rate_limited" ? Math.max(900, pe.opts.retryAfterS ?? 0) : pe?.kind === "retryable" ? Math.min(21600, 600 * 2 ** c.failures) : 86400;
      deps.log.warn({ competitorId: id, err: (e as Error).message }, "competitor collection failed");
      await db.query("UPDATE competitors SET failures = $2::int, last_error = $3::text, claim_until = NULL, next_collect_at = now() + make_interval(secs => $4::int), status = CASE WHEN $2::int >= $5::int AND $6::boolean THEN 'disabled' ELSE status END WHERE id = $1", [id, f, (e as Error).message.slice(0, 300), delayS, FAILURE_LIMIT, pe?.kind === "permanent" || pe === null]).catch((err) => deps.log.error({ err, competitorId: id }, "could not record competitor failure"));
      return "failed";
    }
  }

  const stats = async (workspaceId: string, id: string, from: string, to: string) => {
    const snaps = { rows: (await db.query<{ followers: string | null; collected_at: Date | string }>("SELECT followers::text, collected_at FROM competitor_snapshots WHERE competitor_id = $1 AND workspace_id = $2 ORDER BY collected_at", [id, workspaceId])).rows.map((r) => ({ ...r, collected_at: new Date(r.collected_at).toISOString() })) };   // drivers return timestamptz as Date
    const upTo = snaps.rows.filter((s) => s.collected_at.slice(0, 10) <= to && s.followers !== null), before = upTo.filter((s) => s.collected_at.slice(0, 10) < from);
    const latest = upTo.at(-1);
    const posts = (await db.query<{ external_post_id: string; published_at: string; url: string | null; metrics: Record<string, number> }>("SELECT external_post_id, published_at, url, metrics FROM competitor_posts WHERE competitor_id = $1 AND workspace_id = $2 AND published_at >= $3::date AND published_at < ($4::date + 1) ORDER BY published_at", [id, workspaceId, from, to])).rows;
    const withI = posts.map((p) => ({ ...p, interactions: publicInteractions(p.metrics) })).filter((p) => p.interactions !== null) as (typeof posts[number] & { interactions: number })[];
    const days = Math.max(1, (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1);
    return {
      followers: latest ? { latest: num(latest.followers), asOf: latest.collected_at, change: before.at(-1) && latest ? num(latest.followers)! - num(before.at(-1)!.followers)! : null } : null,
      posts: { inRange: posts.length, perWeek: Number(((posts.length / days) * 7).toFixed(2)), withInteractionData: withI.length },
      publicInteractionsPerPost: { median: median(withI.map((p) => p.interactions)), mean: withI.length ? Number((withI.reduce((s, p) => s + p.interactions, 0) / withI.length).toFixed(1)) : null },
      topPosts: [...withI].sort((a, b) => b.interactions - a.interactions).slice(0, 3).map((p) => ({ url: p.url, publishedAt: p.published_at, interactions: p.interactions })),
      coverageNote: posts.length >= POSTS_PER_COLLECTION ? `Only the ${POSTS_PER_COLLECTION} most recent posts are tracked, so counts for long ranges are lower bounds.` : null,
    };
  };

  return {
    collect,
    async add(a: Actor, workspaceId: string, i: { platform: string; handle: string }) {
      await workspaces.authorize(a.id, workspaceId, "accounts:manage");
      const adapter = registry.list().find((p) => p.platform === i.platform);
      if (!adapter?.available || !adapter.capabilities?.competitorLookup) throw new AppError(422, "CAPABILITY_UNSUPPORTED", `${i.platform} does not expose public competitor data through the API this integration uses (or the integration is not configured)`);
      if ((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM competitors WHERE workspace_id = $1", [workspaceId])).rows[0]!.n >= MAX_PER_WORKSPACE) throw new AppError(409, "COMPETITOR_LIMIT", `A workspace can track at most ${MAX_PER_WORKSPACE} competitors`);
      const token = await tokenFor(workspaceId, i.platform);
      const impl = registry.get(i.platform);
      const profile = await impl.lookupPublicProfile!({ accessToken: token, handle: i.handle }).catch(mapError);
      const own = (await db.query("SELECT 1 FROM social_accounts WHERE workspace_id = $1 AND platform = $2 AND external_id = $3", [workspaceId, i.platform, profile.externalId])).rowCount;
      if (own) throw badRequest("That is one of your own connected accounts: its analytics are already tracked");
      let row: Row;
      try {
        row = (await db.query<Row>(`INSERT INTO competitors (workspace_id, platform, handle, external_id, display_name, avatar_url, added_by, extra_uploads) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${COLS}`, [workspaceId, i.platform, profile.handle, profile.externalId, profile.displayName, profile.avatarUrl ?? null, a.id, profile.uploadsPlaylistId ?? null])).rows[0]!;
      } catch (e) { if ((e as { code?: string }).code === "23505") throw new AppError(409, "ALREADY_TRACKED", "This competitor is already tracked"); throw e; }
      await collect(row.id);                         // first snapshot right away (best effort)
      return view((await db.query<Row>(`SELECT ${COLS} FROM competitors WHERE id = $1`, [row.id])).rows[0]!);
    },
    async list(a: Actor, workspaceId: string) {
      await workspaces.authorize(a.id, workspaceId, "analytics:read");
      return (await db.query<Row>(`SELECT ${COLS} FROM competitors WHERE workspace_id = $1 ORDER BY created_at`, [workspaceId])).rows.map(view);
    },
    async remove(a: Actor, workspaceId: string, id: string) {
      await workspaces.authorize(a.id, workspaceId, "accounts:manage");
      if (!(await db.query("DELETE FROM competitors WHERE workspace_id = $1 AND id = $2", [workspaceId, id])).rowCount) throw notFound("Competitor");
    },
    async get(a: Actor, workspaceId: string, id: string, q: { from?: string | undefined; to?: string | undefined }) {
      await workspaces.authorize(a.id, workspaceId, "analytics:read");
      const c = (await db.query<Row>(`SELECT ${COLS} FROM competitors WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rows[0];
      if (!c) throw notFound("Competitor");
      const r = { ...defaultRange(), ...(q.from ? { from: q.from } : {}), ...(q.to ? { to: q.to } : {}) };
      return { ...view(c), range: r, ...(await stats(workspaceId, id, r.from, r.to)), basis: "Public data only (visible counts through the platform's official API)." };
    },
    /** You vs tracked competitors on ONE platform, using only the metrics that are public for everyone. */
    async compare(a: Actor, workspaceId: string, q: { platform: string; from?: string | undefined; to?: string | undefined }) {
      await workspaces.authorize(a.id, workspaceId, "analytics:read");
      const r = { ...defaultRange(), ...(q.from ? { from: q.from } : {}), ...(q.to ? { to: q.to } : {}) };
      const rows = (await analyticsRepository.postLatest(db, workspaceId, { ...r, platform: q.platform })).rows;
      const per = new Map<string, Record<string, number | null>>();
      for (const x of rows) (per.get(x.target_id) ?? per.set(x.target_id, {}).get(x.target_id)!)[x.metric_key] = num(x.last_value);
      const mine = [...per.values()].map(publicInteractions).filter((v): v is number => v !== null);
      const publishedCount = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM publishing_jobs WHERE workspace_id = $1 AND platform = $2 AND status = 'published' AND published_at >= $3::date AND published_at < ($4::date + 1)", [workspaceId, q.platform, r.from, r.to])).rows[0]!.n;
      const [latest, base] = await Promise.all([analyticsRepository.accountLatest(db, workspaceId, "followers", r.to, q.platform), analyticsRepository.accountBaseline(db, workspaceId, "followers", r.from, q.platform)]);
      const ownFollowers = latest.rows.length ? latest.rows.reduce((s, x) => s + (num(x.last_value) ?? 0), 0) : null;
      const baseSum = latest.rows.every((x) => base.rows.some((b) => b.social_account_id === x.social_account_id)) && latest.rows.length ? base.rows.filter((b) => latest.rows.some((x) => x.social_account_id === b.social_account_id)).reduce((s, b) => s + (num(b.last_value) ?? 0), 0) : null;
      const comps = (await db.query<Row>(`SELECT ${COLS} FROM competitors WHERE workspace_id = $1 AND platform = $2 AND status = 'active' ORDER BY created_at`, [workspaceId, q.platform])).rows;
      return {
        platform: q.platform, range: r,
        you: { followers: ownFollowers, followersChange: ownFollowers !== null && baseSum !== null ? ownFollowers - baseSum : null, posts: { inRange: publishedCount, perWeek: Number(((publishedCount / Math.max(1, (Date.parse(r.to) - Date.parse(r.from)) / 86_400_000 + 1)) * 7).toFixed(2)), withInteractionData: mine.length }, publicInteractionsPerPost: { median: median(mine), mean: mine.length ? Number((mine.reduce((s, v) => s + v, 0) / mine.length).toFixed(1)) : null } },
        competitors: await Promise.all(comps.map(async (c) => ({ id: c.id, handle: c.handle, displayName: c.display_name, ...(await stats(workspaceId, c.id, r.from, r.to)) }))),
        basis: "Everyone is measured on publicly visible interaction counts only (likes, comments, reposts, quotes where the platform provides them). Your private analytics (reach, saves, impressions...) are not used, so the numbers are comparable. Competitor data covers recent posts only.",
      };
    },
    /** Cron: collect due competitors, a few per run. */
    async sweep(limit = 10) {
      const due = (await db.query<{ id: string }>("SELECT c.id FROM competitors c WHERE c.status = 'active' AND c.next_collect_at <= now() AND (c.claim_until IS NULL OR c.claim_until < now()) ORDER BY c.next_collect_at LIMIT $1", [limit])).rows;
      const r = { due: due.length, collected: 0, failed: 0 };
      for (const d of due) { const x = await collect(d.id); if (x === "collected") r.collected++; if (x === "failed") r.failed++; }
      return r;
    },
  };
}
export type CompetitorService = ReturnType<typeof createCompetitorService>;
void z;
