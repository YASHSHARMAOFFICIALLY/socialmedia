import type { Queryable } from "../../infrastructure/database/db.js";
import type { NormalizedMetric } from "./analytics.normalizer.js";

export interface TargetRow {
  id: string; workspace_id: string; social_account_id: string; platform: string; scope: "account" | "post"; job_id: string | null;
  external_post_id: string | null; published_at: string | null; failures: number;
  account_external_id: string; account_metadata: Record<string, unknown>; account_status: string;
}

export const analyticsRepository = {
  // ---- collection scheduling
  seedTargets: async (q: Queryable, accountPlatforms: string[], postPlatforms: string[]) => {
    const a = await q.query(
      `INSERT INTO analytics_targets (workspace_id, social_account_id, platform, scope) SELECT workspace_id, id, platform, 'account' FROM social_accounts
        WHERE status = 'active' AND platform = ANY($1::text[]) ON CONFLICT DO NOTHING`, [accountPlatforms]);
    const p = await q.query(
      `INSERT INTO analytics_targets (workspace_id, social_account_id, platform, scope, job_id, external_post_id, published_at)
       SELECT j.workspace_id, j.social_account_id, j.platform, 'post', j.id, j.external_id, j.published_at FROM publishing_jobs j
        WHERE j.status = 'published' AND j.external_id IS NOT NULL AND j.platform = ANY($1::text[]) ON CONFLICT DO NOTHING`, [postPlatforms]);
    return a.rowCount + p.rowCount;
  },
  /** Due, active targets of healthy accounts that were not queued recently. Marks them queued. */
  dueForQueue: async (q: Queryable, limit: number) =>
    (await q.query<{ id: string }>(
      `UPDATE analytics_targets SET enqueued_at = now() WHERE id IN (
         SELECT t.id FROM analytics_targets t JOIN social_accounts a ON a.id = t.social_account_id AND a.workspace_id = t.workspace_id
          WHERE t.status = 'active' AND a.status = 'active' AND t.next_collect_at <= now() AND (t.enqueued_at IS NULL OR t.enqueued_at < now() - interval '10 minutes')
          ORDER BY t.next_collect_at LIMIT $1 FOR UPDATE OF t SKIP LOCKED) RETURNING id`, [limit])).rows.map((r) => r.id),
  claim: async (q: Queryable, id: string, token: string, seconds: number) =>
    (await q.query<TargetRow>(
      `WITH c AS (UPDATE analytics_targets t SET claim_token = $2, claimed_until = now() + make_interval(secs => $3)
          WHERE t.id = $1 AND t.status = 'active' AND t.next_collect_at <= now() AND (t.claim_token IS NULL OR t.claimed_until < now()) RETURNING t.*)
       SELECT c.id, c.workspace_id, c.social_account_id, c.platform, c.scope, c.job_id, c.external_post_id, c.published_at, c.failures,
              a.external_id AS account_external_id, a.metadata AS account_metadata, a.status AS account_status
         FROM c JOIN social_accounts a ON a.id = c.social_account_id AND a.workspace_id = c.workspace_id`, [id, token, seconds])).rows[0] ?? null,
  finishOk: (q: Queryable, id: string, token: string, nextDelayS: number | null) =>
    q.query(
      `UPDATE analytics_targets SET claim_token = NULL, claimed_until = NULL, failures = 0, last_error = NULL, last_collected_at = now(),
              status = CASE WHEN $3::int IS NULL THEN 'done' ELSE status END, next_collect_at = now() + make_interval(secs => COALESCE($3::int, 0))
        WHERE id = $1 AND claim_token = $2`, [id, token, nextDelayS]),
  finishFail: (q: Queryable, id: string, token: string, delayS: number, error: string, disable: boolean) =>
    q.query(
      `UPDATE analytics_targets SET claim_token = NULL, claimed_until = NULL, failures = failures + 1, last_error = $4,
              status = CASE WHEN $5 THEN 'disabled' ELSE status END, next_collect_at = now() + make_interval(secs => $3)
        WHERE id = $1 AND claim_token = $2`, [id, token, delayS, error.slice(0, 500), disable]),

  // ---- storage (append-only)
  insertSnapshot: async (q: Queryable, t: TargetRow, source: string, raw: unknown) =>
    (await q.query<{ id: string }>(
      `INSERT INTO analytics_snapshots (workspace_id, target_id, social_account_id, platform, scope, job_id, external_post_id, source, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id::text`, [t.workspace_id, t.id, t.social_account_id, t.platform, t.scope, t.job_id, t.external_post_id, source, JSON.stringify(raw ?? null)])).rows[0]!.id,
  insertMetrics: async (q: Queryable, t: TargetRow, snapshotId: string, metrics: NormalizedMetric[]) => {
    for (const m of metrics)
      await q.query(
        `INSERT INTO analytics_metrics (snapshot_id, workspace_id, social_account_id, platform, scope, job_id, external_post_id, metric_key, original_name, definition, value, availability, period, components)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [snapshotId, t.workspace_id, t.social_account_id, t.platform, t.scope, t.job_id, t.external_post_id, m.key, m.originalName, m.definition, m.value, m.availability, m.period, m.components ?? null]);
  },
  bumpVersion: (q: Queryable, workspaceId: string) =>
    q.query("INSERT INTO analytics_versions (workspace_id, version) VALUES ($1, 1) ON CONFLICT (workspace_id) DO UPDATE SET version = analytics_versions.version + 1", [workspaceId]),
  version: async (q: Queryable, workspaceId: string) =>
    (await q.query<{ version: string }>("SELECT version::text FROM analytics_versions WHERE workspace_id = $1", [workspaceId])).rows[0]?.version ?? "0",

  // ---- reads (every query is scoped by workspace_id)
  definitions: (q: Queryable) => q.query<{ key: string; label: string; unit: string; description: string; comparable: boolean; caveat: string | null }>("SELECT key, label, unit, description, comparable, caveat FROM metric_definitions ORDER BY key"),
  /** Latest known value per (post target, metric) for posts published inside the range. */
  postLatest: (q: Queryable, workspaceId: string, f: { from: string; to: string; platform?: string | undefined; accountId?: string | undefined; campaignId?: string | undefined }) =>
    q.query<{ target_id: string; platform: string; social_account_id: string; job_id: string; metric_key: string; last_value: string | null; components: string[] | null }>(
      `SELECT DISTINCT ON (a.target_id, a.metric_key) a.target_id, a.platform, a.social_account_id, a.job_id, a.metric_key, a.last_value::text AS last_value, NULL::text[] AS components
         FROM analytics_aggregates a JOIN analytics_targets t ON t.id = a.target_id
        WHERE a.workspace_id = $1 AND a.grain = 'day' AND a.scope = 'post' AND t.published_at >= $2::date AND t.published_at < ($3::date + 1)
          AND ($4::text IS NULL OR a.platform = $4) AND ($5::uuid IS NULL OR a.social_account_id = $5)
          AND ($6::uuid IS NULL OR a.job_id IN (SELECT j.id FROM publishing_jobs j JOIN campaign_posts cp ON cp.post_id = j.post_id WHERE cp.campaign_id = $6 AND j.workspace_id = a.workspace_id))
        ORDER BY a.target_id, a.metric_key, a.bucket_start DESC`, [workspaceId, f.from, f.to, f.platform ?? null, f.accountId ?? null, f.campaignId ?? null]),
  postTargets: (q: Queryable, workspaceId: string, f: { from: string; to: string; platform?: string | undefined; accountId?: string | undefined; campaignId?: string | undefined }) =>
    q.query<{ platform: string; tracked: number; collected: number; last_collected_at: string | null; disabled: number }>(
      `SELECT platform, count(*)::int AS tracked, count(last_collected_at)::int AS collected, max(last_collected_at) AS last_collected_at, count(*) FILTER (WHERE status = 'disabled')::int AS disabled
         FROM analytics_targets WHERE workspace_id = $1 AND scope = 'post' AND published_at >= $2::date AND published_at < ($3::date + 1)
          AND ($4::text IS NULL OR platform = $4) AND ($5::uuid IS NULL OR social_account_id = $5)
          AND ($6::uuid IS NULL OR job_id IN (SELECT j.id FROM publishing_jobs j JOIN campaign_posts cp ON cp.post_id = j.post_id WHERE cp.campaign_id = $6 AND j.workspace_id = $1)) GROUP BY platform`, [workspaceId, f.from, f.to, f.platform ?? null, f.accountId ?? null, f.campaignId ?? null]),
  accounts: (q: Queryable, workspaceId: string, platform?: string) =>
    q.query<{ id: string; platform: string; display_name: string; status: string }>("SELECT id, platform, display_name, status FROM social_accounts WHERE workspace_id = $1 AND status <> 'disconnected' AND ($2::text IS NULL OR platform = $2) ORDER BY platform, created_at", [workspaceId, platform ?? null]),
  accountTargets: (q: Queryable, workspaceId: string, platform?: string) =>
    q.query<{ social_account_id: string; platform: string; status: string; last_collected_at: string | null; last_error: string | null }>("SELECT social_account_id, platform, status, last_collected_at, last_error FROM analytics_targets WHERE workspace_id = $1 AND scope = 'account' AND ($2::text IS NULL OR platform = $2)", [workspaceId, platform ?? null]),
  /** Collection health per platform + scope (freshness for dashboards and MCP). No raw error text: counts only. */
  syncStatus: (q: Queryable, workspaceId: string) =>
    q.query<{ platform: string; scope: string; targets: number; active: number; failing: number; disabled: number; last_collected_at: string | null }>(
      `SELECT platform, scope, count(*)::int AS targets, count(*) FILTER (WHERE status = 'active')::int AS active,
              count(*) FILTER (WHERE failures > 0 AND status <> 'disabled')::int AS failing, count(*) FILTER (WHERE status = 'disabled')::int AS disabled,
              max(last_collected_at) AS last_collected_at
         FROM analytics_targets WHERE workspace_id = $1 GROUP BY platform, scope ORDER BY platform, scope`, [workspaceId]),
  /** Per-target aggregate rows for a metric over a range, at a grain (post deltas or account values). */
  aggregateRows: (q: Queryable, workspaceId: string, f: { scope: "post" | "account"; metric: string; grain: string; from: string; to: string; platform?: string | undefined; accountId?: string | undefined; jobId?: string | undefined; campaignId?: string | undefined }) =>
    q.query<{ target_id: string; social_account_id: string; platform: string; bucket: string; last_value: string | null; delta: string | null }>(
      `SELECT target_id, social_account_id, platform, bucket_start::text AS bucket, last_value::text, delta::text FROM analytics_aggregates
        WHERE workspace_id = $1 AND scope = $2 AND metric_key = $3 AND grain = $4 AND bucket_start >= $5::date AND bucket_start <= $6::date
          AND ($7::text IS NULL OR platform = $7) AND ($8::uuid IS NULL OR social_account_id = $8) AND ($9::uuid IS NULL OR job_id = $9)
          AND ($10::uuid IS NULL OR job_id IN (SELECT j.id FROM publishing_jobs j JOIN campaign_posts cp ON cp.post_id = j.post_id WHERE cp.campaign_id = $10 AND j.workspace_id = $1)) ORDER BY bucket_start`,
      [workspaceId, f.scope, f.metric, f.grain, f.from, f.to, f.platform ?? null, f.accountId ?? null, f.jobId ?? null, f.campaignId ?? null]),
  /** Value of each account/metric at (or the last one before) the start of a range: baseline for growth. */
  accountBaseline: (q: Queryable, workspaceId: string, metric: string, before: string, platform?: string) =>
    q.query<{ social_account_id: string; platform: string; last_value: string | null }>(
      `SELECT DISTINCT ON (target_id) social_account_id, platform, last_value::text FROM analytics_aggregates
        WHERE workspace_id = $1 AND scope = 'account' AND metric_key = $2 AND grain = 'day' AND bucket_start < $3::date AND last_value IS NOT NULL AND ($4::text IS NULL OR platform = $4)
        ORDER BY target_id, bucket_start DESC`, [workspaceId, metric, before, platform ?? null]),
  accountLatest: (q: Queryable, workspaceId: string, metric: string, to: string, platform?: string, accountId?: string) =>
    q.query<{ social_account_id: string; platform: string; last_value: string | null; bucket: string }>(
      `SELECT DISTINCT ON (target_id) social_account_id, platform, last_value::text, bucket_start::text AS bucket FROM analytics_aggregates
        WHERE workspace_id = $1 AND scope = 'account' AND metric_key = $2 AND grain = 'day' AND bucket_start <= $3::date AND last_value IS NOT NULL AND ($4::text IS NULL OR platform = $4) AND ($5::uuid IS NULL OR social_account_id = $5)
        ORDER BY target_id, bucket_start DESC`, [workspaceId, metric, to, platform ?? null, accountId ?? null]),
  /** Latest normalized rows of one post destination, WITH availability (this is where "unavailable" is visible). */
  postLatestMetrics: (q: Queryable, workspaceId: string, jobId: string) =>
    q.query<{ metric_key: string; original_name: string; definition: string | null; value: string | null; availability: string; components: string[] | null; collected_at: string }>(
      `SELECT DISTINCT ON (metric_key) metric_key, original_name, definition, value::text, availability, components, collected_at FROM analytics_metrics
        WHERE workspace_id = $1 AND job_id = $2 ORDER BY metric_key, collected_at DESC, id DESC`, [workspaceId, jobId]),
  postJob: async (q: Queryable, workspaceId: string, jobId: string) =>
    (await q.query<{ id: string; post_id: string; platform: string; social_account_id: string; status: string; external_url: string | null; published_at: string | null; target_status: string | null; last_collected_at: string | null; last_error: string | null }>(
      `SELECT j.id, j.post_id, j.platform, j.social_account_id, j.status, j.external_url, j.published_at, t.status AS target_status, t.last_collected_at, t.last_error
         FROM publishing_jobs j LEFT JOIN analytics_targets t ON t.job_id = j.id WHERE j.workspace_id = $1 AND j.id = $2`, [workspaceId, jobId])).rows[0] ?? null,
  jobsForPost: (q: Queryable, workspaceId: string, postId: string) => q.query<{ id: string }>("SELECT id FROM publishing_jobs WHERE workspace_id = $1 AND post_id = $2 AND status = 'published' ORDER BY created_at", [workspaceId, postId]),
  topPosts: (q: Queryable, workspaceId: string, f: { metric: string; from: string; to: string; platform?: string | undefined; accountId?: string | undefined; limit: number }) =>
    q.query<{ job_id: string; post_id: string; platform: string; social_account_id: string; value: string; title: string | null; preview: string; url: string | null; published_at: string; media_kind: string | null }>(
      `SELECT l.job_id, j.post_id, l.platform, l.social_account_id, l.last_value::text AS value, p.title, left(p.body, 140) AS preview, j.external_url AS url, j.published_at,
              (SELECT m.kind FROM post_media pm JOIN media_assets m ON m.id = pm.media_id WHERE pm.post_id = p.id AND pm.role = 'media' ORDER BY pm.position LIMIT 1) AS media_kind
         FROM (SELECT DISTINCT ON (a.target_id) a.job_id, a.platform, a.social_account_id, a.last_value FROM analytics_aggregates a JOIN analytics_targets t ON t.id = a.target_id
                WHERE a.workspace_id = $1 AND a.grain = 'day' AND a.scope = 'post' AND a.metric_key = $2 AND a.last_value IS NOT NULL
                  AND t.published_at >= $3::date AND t.published_at < ($4::date + 1) AND ($5::text IS NULL OR a.platform = $5) AND ($6::uuid IS NULL OR a.social_account_id = $6)
                ORDER BY a.target_id, a.bucket_start DESC) l
         JOIN publishing_jobs j ON j.id = l.job_id JOIN posts p ON p.id = j.post_id AND p.workspace_id = j.workspace_id
        ORDER BY l.last_value DESC, j.published_at DESC LIMIT $7`, [workspaceId, f.metric, f.from, f.to, f.platform ?? null, f.accountId ?? null, f.limit]),
  /** Every latest metric of every post destination published in range (for exports). */
  postsWide: (q: Queryable, workspaceId: string, f: { from: string; to: string; platform?: string | undefined; campaignId?: string | undefined; limit: number }) =>
    q.query<{ job_id: string; platform: string; account_name: string; published_at: string; external_url: string | null; title: string | null; preview: string; metric_key: string | null; last_value: string | null }>(
      `SELECT j.id AS job_id, j.platform, a.display_name AS account_name, j.published_at, j.external_url, p.title, left(p.body, 140) AS preview, l.metric_key, l.last_value::text
         FROM publishing_jobs j JOIN posts p ON p.id = j.post_id AND p.workspace_id = j.workspace_id JOIN social_accounts a ON a.id = j.social_account_id AND a.workspace_id = j.workspace_id
         LEFT JOIN LATERAL (SELECT DISTINCT ON (g.metric_key) g.metric_key, g.last_value FROM analytics_aggregates g WHERE g.job_id = j.id AND g.grain = 'day' AND g.scope = 'post' ORDER BY g.metric_key, g.bucket_start DESC) l ON true
        WHERE j.workspace_id = $1 AND j.status = 'published' AND j.published_at >= $2::date AND j.published_at < ($3::date + 1) AND ($4::text IS NULL OR j.platform = $4)
          AND ($5::uuid IS NULL OR j.post_id IN (SELECT post_id FROM campaign_posts WHERE campaign_id = $5 AND workspace_id = $1))
        ORDER BY j.published_at, j.id LIMIT $6`, [workspaceId, f.from, f.to, f.platform ?? null, f.campaignId ?? null, f.limit]),
};
