import { describe, it, expect } from "vitest";
import request from "supertest";
import pino from "pino";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config/env.js";
import type { Db } from "../src/infrastructure/database/db.js";

const cfg = loadConfig({ NODE_ENV: "test" });
const mk = (dbOk: boolean) => {
  const db = {
    query: async (t: string) => {
      if (!dbOk) throw new Error("down");
      if (t.includes("worker_heartbeats")) return { rows: [{ name: "scheduling", age: 5 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  } as unknown as Db;
  return createApp({ cfg, log: pino({ level: "silent" }), db, auth: { handler: async () => new Response() } as never, workspaces: {} as never, accounts: {} as never, content: {} as never, publishing: {} as never, media: {} as never, scheduling: {} as never, analytics: {} as never, campaigns: {} as never, approvals: {} as never, notifications: {} as never, insights: {} as never, reports: {} as never, recurring: {} as never, webhooks: {} as never, competitors: {} as never, ai: {} as never, engine: {} as never });
};

describe("health", () => {
  it("live ok regardless of deps", async () => {
    const r = await request(mk(false)).get("/health/live");
    expect(r.status).toBe(200);
    expect(r.headers["x-request-id"]).toBeTruthy();
  });
  it("ready 200 when db up, 503 when down", async () => {
    expect((await request(mk(true)).get("/health/ready")).status).toBe(200);
    expect((await request(mk(false)).get("/health/ready")).status).toBe(503);
  });
  it("workers endpoint reports alive and dead workers", async () => {
    const r = await request(mk(true)).get("/health/workers");
    expect(r.body.data.scheduling.alive).toBe(true);
    expect(r.body.data.analytics.alive).toBe(false);
  });
  it("public docs routes are not behind auth", async () => {
    expect((await request(mk(true)).get("/openapi.json")).status).toBe(200);
    expect((await request(mk(true)).get("/docs")).status).toBe(200);
  });
  it("unknown route gives error envelope", async () => {
    const r = await request(mk(true)).get("/nope");
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe("NOT_FOUND");
  });
});
