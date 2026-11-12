import request from "supertest";
import pino from "pino";
import { createApp } from "../../src/app.js";
import { loadConfig } from "../../src/config/env.js";
import { buildDeps } from "../../src/composition.js";
import type { Db } from "../../src/infrastructure/database/db.js";
import type { ObjectStorage } from "../../src/infrastructure/storage/storage.js";
import type { SocialAdapter } from "../../src/integrations/core/types.js";
import { migrate } from "../../src/infrastructure/database/migrate.js";
import type { Mailer } from "../../src/infrastructure/email/resend.js";
import { createTestDb } from "./pglite-db.js";

export const ORIGIN = "http://localhost:3000";

export const TEST_KEYS = "1:" + Buffer.alloc(32, 7).toString("base64");

export function createMemoryQueue() {
  const sent: string[] = [];
  return { sent, queue: { sendBatch: async (m: { jobId: string }[]) => void sent.push(...m.map((x) => x.jobId)) } };
}

export async function createTestApp(adapters: SocialAdapter[] = [], o: { engine?: Parameters<typeof buildDeps>[3]["engine"]; queueFails?: () => boolean; storage?: ObjectStorage | null; mailer?: Mailer; wrapDb?: (db: Db) => Db; webhookFetch?: typeof fetch; images?: import("../../src/infrastructure/storage/image-transform.js").ImageTransformer | null; videos?: import("../../src/infrastructure/storage/video-transform.js").VideoTransformer | null; aiProvider?: import("../../src/infrastructure/ai/provider.js").AiProvider | null; env?: Record<string, string>; payments?: import("../../src/integrations/payments/types.js").PaymentProvider | null } = {}) {
  const created = await createTestDb();
  const db = o.wrapDb ? o.wrapDb(created.db) : created.db;
  const close = created.close;
  await migrate(created.db);
  const sent: { to: string; subject: string; html: string }[] = [];
  const mailer: Mailer = o.mailer ?? { send: async (m) => void sent.push(m) };
  const cfg = loadConfig({ NODE_ENV: "test", BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-123", BETTER_AUTH_URL: ORIGIN, APP_URL: ORIGIN, TOKEN_ENC_KEYS: TEST_KEYS, NOTIFY_PRODUCER_LAG_S: "0", ...o.env });
  const log = pino({ level: "silent" });
  const mq = createMemoryQueue();
  const queue = { sendBatch: async (m: { jobId: string }[]) => { if (o.queueFails?.()) throw new Error("queue down"); await mq.queue.sendBatch(m); } };
  const aq: string[] = [];
  const analyticsQueue = { sendBatch: async (m: { targetId: string }[]) => void aq.push(...m.map((x) => x.targetId)) };
  const deps = await buildDeps(cfg, log, db, { mailer, adapters, queue, analyticsQueue, ...(o.engine ? { engine: o.engine } : {}), ...(o.storage !== undefined ? { storage: o.storage } : {}), ...(o.webhookFetch ? { webhookFetch: o.webhookFetch } : {}), ...(o.aiProvider !== undefined ? { aiProvider: o.aiProvider } : {}), ...(o.images !== undefined ? { images: o.images } : {}), ...(o.videos !== undefined ? { videos: o.videos } : {}), ...(o.payments !== undefined ? { payments: o.payments } : {}) });
  const app = createApp(deps);
  let n = 0;
  /** Registers a fresh user and returns a cookie-carrying agent. */
  async function newUser(label = "user") {
    const email = `${label}${++n}@example.com`;
    const agent = request.agent(app);
    const res = await agent.post("/api/auth/sign-up/email").set("Origin", ORIGIN).send({ name: label, email, password: "correct-horse-battery" });
    if (res.status !== 200) throw new Error(`sign-up failed ${res.status} ${JSON.stringify(res.body)}`);
    return { agent, email, id: res.body.user.id as string };
  }
  return { app, db, sent, newUser, close, deps, queued: mq.sent, analyticsQueued: aq };
}

/** In-memory ObjectStorage for tests (the real one is exercised through mocked HTTP in storage.test.ts). */
export function createMemoryStorage() {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const storage: ObjectStorage = {
    presignPut: async (key, { contentType, expiresS }) => ({ url: `https://store.test/${key}?expires=${expiresS}`, headers: { "Content-Type": contentType } }),
    presignGet: async (key, expiresS) => `https://store.test/${key}?get&expires=${expiresS}`,
    head: async (key) => { const o = objects.get(key); return o ? { size: o.bytes.length, contentType: o.contentType } : null; },
    readRange: async (key, start, end) => objects.get(key)!.bytes.slice(start, end + 1),
    delete: async (key) => void objects.delete(key),
    put: async (key, bytes, contentType) => void objects.set(key, { bytes, contentType }),
  };
  return { storage, objects, put: (key: string, bytes: Uint8Array, contentType: string) => void objects.set(key, { bytes, contentType }) };
}
