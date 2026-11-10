import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "./db.js";

const defaultDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");
const LOCK_KEY = 727_001;

/**
 * Applies *.sql files in name order; each file runs in its own transaction under an advisory xact lock,
 * so concurrent migrators serialize. Applied files are checksum-locked (editing one is an error).
 */
export async function migrate(db: Db, dir = defaultDir): Promise<string[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  await db.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
  const applied: string[] = [];
  for (const f of files) {
    const sql = await readFile(path.join(dir, f), "utf8");
    const sum = createHash("sha256").update(sql).digest("hex");
    try {
      const did = await db.tx(async (q) => {
        await q.query("SELECT pg_advisory_xact_lock($1)", [LOCK_KEY]);
        const prev = (await q.query<{ checksum: string }>("SELECT checksum FROM schema_migrations WHERE name = $1", [f])).rows[0];
        if (prev) {
          if (prev.checksum !== sum) throw new Error("modified after being applied");
          return false;
        }
        await q.query(sql);
        await q.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [f, sum]);
        return true;
      });
      if (did) applied.push(f);
    } catch (e) {
      throw new Error(`Migration ${f} failed: ${(e as Error).message}`);
    }
  }
  return applied;
}
