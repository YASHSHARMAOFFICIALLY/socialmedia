import { describe, it, expect, afterAll } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { migrate } from "../src/infrastructure/database/migrate.js";
import { createTestDb } from "./helpers/pglite-db.js";

describe("migrator", async () => {
  const { db, close } = await createTestDb();
  const dir = await mkdtemp(path.join(tmpdir(), "mig-"));
  await writeFile(path.join(dir, "0001.sql"), "CREATE TABLE mig_t (id int);");
  afterAll(async () => { await close(); await rm(dir, { recursive: true }); });

  it("applies once, is idempotent", async () => {
    expect(await migrate(db, dir)).toEqual(["0001.sql"]);
    expect(await migrate(db, dir)).toEqual([]);
  });
  it("rejects a modified applied migration", async () => {
    await writeFile(path.join(dir, "0001.sql"), "CREATE TABLE mig_t (id int, x int);");
    await expect(migrate(db, dir)).rejects.toThrow(/modified/);
    await writeFile(path.join(dir, "0001.sql"), "CREATE TABLE mig_t (id int);");
  });
  it("rolls back a failing migration and records nothing", async () => {
    await writeFile(path.join(dir, "0002.sql"), "CREATE TABLE ok_t(id int); SELECT boom();");
    await expect(migrate(db, dir)).rejects.toThrow(/0002.sql failed/);
    expect((await db.query("SELECT to_regclass('ok_t') AS t")).rows[0]).toEqual({ t: null });
    expect((await db.query("SELECT 1 FROM schema_migrations WHERE name='0002.sql'")).rowCount).toBe(0);
  });
  it("real migrations apply cleanly", async () => {
    const { db: d2, close: c2 } = await createTestDb();
    expect((await migrate(d2)).length).toBeGreaterThanOrEqual(2);
    await c2();
  });
});
