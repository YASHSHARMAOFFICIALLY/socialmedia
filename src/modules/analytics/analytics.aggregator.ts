import type { Queryable } from "../../infrastructure/database/db.js";

const GRAINS = ["day", "week", "month"] as const;

/**
 * Rebuilds the roll-ups for one target (idempotent; derived data only). For each metric and bucket: the last known value, and the
 * change since the previous bucket. delta is NULL (not 0) for the first bucket or when either side has no value.
 * Buckets are UTC calendar days / ISO weeks / months. Only the last 400 days are touched.
 */
export async function rebuildAggregates(q: Queryable, targetId: string) {
  for (const grain of GRAINS) {
    await q.query(
      `INSERT INTO analytics_aggregates (workspace_id, scope, target_id, social_account_id, platform, job_id, metric_key, grain, bucket_start, last_value, delta, samples)
       SELECT workspace_id, scope, target_id, social_account_id, platform, job_id, metric_key, $2, bucket_start, last_value,
              last_value - LAG(last_value) OVER (PARTITION BY metric_key ORDER BY bucket_start) AS delta, samples
         FROM (
           SELECT s.workspace_id, s.scope, s.target_id, s.social_account_id, s.platform, s.job_id, m.metric_key,
                  date_trunc($2, m.collected_at AT TIME ZONE 'UTC')::date AS bucket_start,
                  (array_agg(m.value ORDER BY m.collected_at DESC, m.id DESC) FILTER (WHERE m.availability = 'available'))[1] AS last_value,
                  count(*) FILTER (WHERE m.availability = 'available')::int AS samples
             FROM analytics_metrics m JOIN analytics_snapshots s ON s.id = m.snapshot_id
            WHERE s.target_id = $1 AND m.period = 'lifetime' AND m.collected_at >= now() - interval '400 days'
            GROUP BY s.workspace_id, s.scope, s.target_id, s.social_account_id, s.platform, s.job_id, m.metric_key, date_trunc($2, m.collected_at AT TIME ZONE 'UTC')::date
         ) b
       ON CONFLICT (target_id, metric_key, grain, bucket_start) DO UPDATE SET last_value = EXCLUDED.last_value, delta = EXCLUDED.delta, samples = EXCLUDED.samples, computed_at = now()`,
      [targetId, grain]);
  }
}

export interface SeriesPoint { bucket: string; value: number | null; partial: boolean }

/**
 * Sums per-target values bucket by bucket. `partial` marks buckets where at least one target had NO value, so a consumer can tell
 * "the total" from "the total of what we know".
 */
export function sumSeries(rows: { bucket: string; value: number | null }[]): SeriesPoint[] {
  const by = new Map<string, { sum: number; known: number; unknown: number }>();
  for (const r of rows) {
    const e = by.get(r.bucket) ?? { sum: 0, known: 0, unknown: 0 };
    if (r.value === null) e.unknown++; else { e.sum += r.value; e.known++; }
    by.set(r.bucket, e);
  }
  return [...by.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([bucket, e]) => ({ bucket, value: e.known ? e.sum : null, partial: e.unknown > 0 }));
}

/** Sums the latest known value of each account across buckets, carrying values forward (follower counts persist between collections). */
export function carryForwardSum(rows: { account: string; bucket: string; value: number | null }[]): SeriesPoint[] {
  const buckets = [...new Set(rows.map((r) => r.bucket))].sort();
  const accounts = [...new Set(rows.map((r) => r.account))];
  const val = new Map(rows.map((r) => [`${r.account}|${r.bucket}`, r.value]));
  const last = new Map<string, number>();
  return buckets.map((bucket) => {
    for (const a of accounts) { const v = val.get(`${a}|${bucket}`); if (v != null) last.set(a, v); }
    const known = accounts.filter((a) => last.has(a));
    return { bucket, value: known.length ? known.reduce((s, a) => s + last.get(a)!, 0) : null, partial: known.length < accounts.length };
  });
}
