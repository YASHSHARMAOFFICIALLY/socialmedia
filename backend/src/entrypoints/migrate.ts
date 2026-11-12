// Node script: `DATABASE_URL=... npm run migrate` (direct Neon connection, not Hyperdrive).
import pg from "pg";
import { migrate } from "../infrastructure/database/migrate.js";
import { poolDb } from "../infrastructure/database/db.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  const applied = await migrate(poolDb(pool));
  console.log(applied.length ? `applied: ${applied.join(", ")}` : "no pending migrations");
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
