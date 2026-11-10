import { createCipher } from "../../src/infrastructure/encryption/cipher.js";
import { TEST_KEYS, type createTestApp } from "./app.js";

export type T = Awaited<ReturnType<typeof createTestApp>>;
export type U = Awaited<ReturnType<T["newUser"]>>;
const cipher = await createCipher(TEST_KEYS);

/** Shared scaffolding: workspace + connected accounts (with real encrypted credentials) + a draft post. */
export async function world(t: T, platforms: string[] = ["linkedin"], body = "Hello world") {
  const owner = await t.newUser("owner");
  const ws = (await owner.agent.post("/workspaces").send({ name: "W" })).body.data.id as string;
  const accounts: Record<string, string> = {};
  for (const p of platforms) accounts[p] = await seedAccount(t, ws, owner, p);
  const post = (await owner.agent.post(`/workspaces/${ws}/posts`).send({ body, title: "T", variants: platforms.map((p) => ({ accountId: accounts[p] })) })).body.data.id as string;
  return { owner, ws, accounts, post };
}
export async function seedAccount(t: T, ws: string, user: U, platform: string, expiresInS = 30 * 86400) {
  const id = (await t.db.query<{ id: string }>("INSERT INTO social_accounts (workspace_id, platform, external_id, display_name, account_type, connected_by) VALUES ($1,$2,$3,'acct','personal',$4) RETURNING id", [ws, platform, `${platform}-${Math.random()}`, user.id])).rows[0]!.id;
  await t.db.query("INSERT INTO oauth_credentials (social_account_id, workspace_id, access_token_enc, expires_at) VALUES ($1,$2,$3, now() + make_interval(secs => $4))", [id, ws, await cipher.encrypt("plain-access-token", `cred:${id}`), expiresInS]);
  return id;
}
export const publish = (u: U, ws: string, post: string, body: object = {}, key?: string) => {
  const r = u.agent.post(`/workspaces/${ws}/posts/${post}/publish`);
  return (key ? r.set("Idempotency-Key", key) : r).send(body);
};
export const jobs = async (t: T, ws: string) => (await t.db.query<{ id: string; platform: string; status: string; attempt_count: number; failure_kind: string | null; needs_reconciliation: boolean; external_id: string | null }>("SELECT id, platform, status, attempt_count, failure_kind, needs_reconciliation, external_id FROM publishing_jobs WHERE workspace_id = $1 ORDER BY platform", [ws])).rows;
/** Simulates the queue consumer: process everything the relay has put on the queue. */
export async function drain(t: T) { const out: string[] = []; while (t.queued.length) out.push(await t.deps.engine.process(t.queued.shift()!)); return out; }
export const makeDue = (t: T, jobId: string) => t.db.query("UPDATE publishing_jobs SET next_attempt_at = now() - interval '1 second', last_enqueued_at = NULL WHERE id = $1", [jobId]);

