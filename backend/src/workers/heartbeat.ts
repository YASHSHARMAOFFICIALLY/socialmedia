import type { Db } from "../infrastructure/database/db.js";

export const WORKER_NAMES = ["publishing", "analytics", "scheduling"] as const;   // queue consumers + the cron sweeper
export type WorkerName = (typeof WORKER_NAMES)[number];

export const beat = (db: Db, name: WorkerName, detail?: unknown) =>
  db.query(
    "INSERT INTO worker_heartbeats (name, last_seen, detail) VALUES ($1, now(), $2) ON CONFLICT (name) DO UPDATE SET last_seen = now(), detail = EXCLUDED.detail",
    [name, detail === undefined ? null : JSON.stringify(detail)],
  );

/** A worker is alive if it beat within maxAgeS. */
export async function workerStatus(db: Db, maxAgeS = 180) {
  const rows = (await db.query<{ name: string; age: number }>("SELECT name, EXTRACT(EPOCH FROM now() - last_seen)::float8 AS age FROM worker_heartbeats")).rows;
  const byName = new Map(rows.map((r) => [r.name, r.age]));
  return Object.fromEntries(WORKER_NAMES.map((n) => [n, byName.has(n) ? { alive: byName.get(n)! <= maxAgeS, lastBeatSecondsAgo: Math.round(byName.get(n)!) } : { alive: false }]));
}
