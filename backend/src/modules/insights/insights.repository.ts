import type { Queryable } from "../../infrastructure/database/db.js";
import type { PostPerf } from "./insights.rules.js";

export const insightsRepository = {
  posts: async (q: Queryable, workspaceId: string, from: string, to: string): Promise<PostPerf[]> =>
    (await q.query<{ job_id: string; platform: string; published_at: string; format: string; interactions: string | null; views: string | null; impressions: string | null; reach: string | null }>(
      `WITH latest AS (
         SELECT DISTINCT ON (a.target_id, a.metric_key) a.target_id, a.job_id, a.platform, a.metric_key, a.last_value
           FROM analytics_aggregates a JOIN analytics_targets t ON t.id = a.target_id
          WHERE a.workspace_id = $1 AND a.grain = 'day' AND a.scope = 'post' AND t.published_at >= $2::date AND t.published_at < ($3::date + 1)
          ORDER BY a.target_id, a.metric_key, a.bucket_start DESC)
       SELECT l.job_id, l.platform, j.published_at,
              COALESCE((SELECT m.kind FROM post_media pm JOIN media_assets m ON m.id = pm.media_id WHERE pm.post_id = j.post_id AND pm.role = 'media' ORDER BY pm.position LIMIT 1), 'text') AS format,
              max(l.last_value) FILTER (WHERE l.metric_key = 'interactions')::text AS interactions, max(l.last_value) FILTER (WHERE l.metric_key = 'views')::text AS views,
              max(l.last_value) FILTER (WHERE l.metric_key = 'impressions')::text AS impressions, max(l.last_value) FILTER (WHERE l.metric_key = 'reach')::text AS reach
         FROM latest l JOIN publishing_jobs j ON j.id = l.job_id GROUP BY l.job_id, l.platform, j.published_at, j.post_id ORDER BY j.published_at`, [workspaceId, from, to])).rows
      .map((r) => ({ jobId: r.job_id, platform: r.platform, publishedAt: new Date(r.published_at).toISOString(), format: r.format as PostPerf["format"], interactions: r.interactions === null ? null : Number(r.interactions), views: r.views === null ? null : Number(r.views), impressions: r.impressions === null ? null : Number(r.impressions), reach: r.reach === null ? null : Number(r.reach) })),
  published: async (q: Queryable, workspaceId: string, from: string, to: string) =>
    (await q.query<{ platform: string; published_at: string }>("SELECT platform, published_at FROM publishing_jobs WHERE workspace_id = $1 AND status = 'published' AND published_at >= $2::date AND published_at < ($3::date + 1) ORDER BY published_at", [workspaceId, from, to])).rows.map((r) => ({ platform: r.platform, publishedAt: new Date(r.published_at).toISOString() })),
  /** Sum of day-over-day changes in the lifetime interaction counters inside a window; null = no sample to compare. */
  gain: async (q: Queryable, workspaceId: string, from: string, to: string) =>
    (await q.query<{ platform: string; gain: string | null }>(
      `SELECT platform, sum(delta)::text AS gain FROM analytics_aggregates WHERE workspace_id = $1 AND scope = 'post' AND metric_key = 'interactions' AND grain = 'day' AND bucket_start BETWEEN $2::date AND $3::date AND delta IS NOT NULL GROUP BY platform`, [workspaceId, from, to])).rows,
};
