import pg from "pg";

/**
 * timestamptz as a Date that keeps Postgres' microseconds. JSON/API output is unchanged (ms ISO via toJSON), but keyset
 * cursors encode `raw`: a ms-truncated cursor would re-return or skip rows that share a transaction's `now()`.
 */
export class PgDate extends Date {
  constructor(readonly raw: string) { super(raw.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00")); }
}
export const parseTimestamptz = (v: string): Date => (/^\d{4}-/.test(v) ? new PgDate(v) : new Date(v));
const TIMESTAMPTZ = 1184;
pg.types.setTypeParser(TIMESTAMPTZ, parseTimestamptz);

export interface QueryResult<R> { rows: R[]; rowCount: number; command?: string }
export interface Queryable {
  query<R = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<QueryResult<R>>;
}
/** A dedicated connection (needed by libraries that run their own BEGIN/COMMIT, e.g. Better Auth via Kysely). */
export interface Session extends Queryable { release(): Promise<void> }
/** Runtime-agnostic DB handle. All SQL is parameterized; repositories only see this interface. */
export interface Db extends Queryable {
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  session(): Promise<Session>;
}

const wrap = (c: pg.ClientBase): Queryable => ({
  query: async (t, p) => { const r = await c.query(t, p as unknown[]); return { rows: r.rows, rowCount: r.rowCount ?? 0, command: r.command }; },
});

async function runTx<T>(c: pg.ClientBase, fn: (q: Queryable) => Promise<T>): Promise<T> {
  const q = wrap(c);
  await c.query("BEGIN");
  try {
    const out = await fn(q);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  }
}

/** Node (scripts, migrations): normal pooled connections. */
export function poolDb(pool: pg.Pool): Db {
  return {
    query: async (t, p) => { const r = await pool.query(t, p as unknown[]); return { rows: r.rows, rowCount: r.rowCount ?? 0 }; },
    tx: async (fn) => { const c = await pool.connect(); try { return await runTx(c, fn); } finally { c.release(); } },
    session: async () => { const c = await pool.connect(); return { ...wrap(c), release: async () => c.release() }; },
  };
}

/**
 * Cloudflare Workers: connections can't be shared across requests, so open a short-lived client per
 * query/transaction. Hyperdrive pools the real connections near the database, making this cheap.
 */
export function hyperdriveDb(connectionString: string): Db {
  const open = async () => { const c = new pg.Client({ connectionString, connectionTimeoutMillis: 5000 }); await c.connect(); return c; };
  return {
    query: async (t, p) => {
      const c = await open();
      try { const r = await c.query(t, p as unknown[]); return { rows: r.rows, rowCount: r.rowCount ?? 0 }; } finally { await c.end().catch(() => {}); }
    },
    tx: async (fn) => { const c = await open(); try { return await runTx(c, fn); } finally { await c.end().catch(() => {}); } },
    session: async () => { const c = await open(); return { ...wrap(c), release: async () => { await c.end().catch(() => {}); } }; },
  };
}
