import { afterAll, beforeAll, expect, it } from "vitest";
import { createTestDb } from "./helpers/pglite-db.js";
import { decodeCursor, page } from "../src/shared/utils/pagination.js";
import { z } from "zod";
import type { Db } from "../src/infrastructure/database/db.js";

let db: Db, close: () => Promise<void>;
beforeAll(async () => { ({ db, close } = await createTestDb()); await db.query("CREATE TABLE t (id int PRIMARY KEY, created_at timestamptz NOT NULL)"); });
afterAll(() => close());

const schema = z.object({ createdAt: z.string(), id: z.coerce.number() });

it("keyset cursor keeps microseconds: rows sharing a timestamp are neither repeated nor skipped", async () => {
  for (const id of [1, 2, 3, 4, 5]) await db.query("INSERT INTO t VALUES ($1, '2026-01-01T00:00:00.123456Z')", [id]);
  for (const dir of ["asc", "desc"] as const) {
    const seen: number[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 10; i++) {
      const a = decodeCursor(cursor, schema);
      const cmp = dir === "asc" ? ">" : "<";
      const rows = (await db.query<{ id: number; created_at: string }>(`SELECT id, created_at FROM t WHERE ($1::timestamptz IS NULL OR (created_at, id) ${cmp} ($1::timestamptz, $2::int)) ORDER BY created_at ${dir}, id ${dir} LIMIT 3`, [a?.createdAt ?? null, a?.id ?? null])).rows;
      const p = page(rows, 2, (r) => ({ createdAt: r.created_at, id: r.id }));
      seen.push(...p.items.map((r) => r.id));
      if (!p.nextCursor) break;
      cursor = p.nextCursor;
    }
    expect(seen).toEqual(dir === "asc" ? [1, 2, 3, 4, 5] : [5, 4, 3, 2, 1]);
  }
});
