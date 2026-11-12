import { PGlite } from "@electric-sql/pglite";
import { parseTimestamptz, type Db, type Queryable } from "../../src/infrastructure/database/db.js";

/** In-process Postgres (WASM): real SQL semantics, no Docker, no network. */
export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const pg = new PGlite({ parsers: { 1184: parseTimestamptz } });
  await pg.waitReady;
  const wrap = (c: { query: PGlite["query"]; exec: PGlite["exec"] }): Queryable => ({
    query: async <R,>(t: string, p?: readonly unknown[]) => {
      // PGlite's extended protocol rejects multi-statement SQL; parameterless calls (migrations) go through exec.
      if (!p || p.length === 0) {
        const rs = await c.exec(t);
        const r = rs[rs.length - 1];
        return { rows: (r?.rows ?? []) as R[], rowCount: Math.max(r?.affectedRows ?? 0, r?.rows.length ?? 0) };
      }
      const r = await c.query<R>(t, p as unknown[]);
      return { rows: r.rows, rowCount: Math.max(r.affectedRows ?? 0, r.rows.length) }; // pg reports SELECT row counts; PGlite does not
    },
  });
  const db: Db = { ...wrap(pg), tx: (fn) => pg.transaction((t) => fn(wrap(t as never))), session: async () => ({ ...wrap(pg), release: async () => {} }) };
  return { db, close: () => pg.close() };
}
