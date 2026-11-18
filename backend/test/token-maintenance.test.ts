import { describe, it, expect, afterAll } from "vitest";
import { refreshWithTimeout } from "../src/modules/accounts/account.service.js";
import { createCipher } from "../src/infrastructure/encryption/cipher.js";
import { PlatformError } from "../src/integrations/core/errors.js";
import { NO_CAPABILITIES, type SocialAdapter } from "../src/integrations/core/types.js";
import { createTestApp, TEST_KEYS } from "./helpers/app.js";
import { seedAccount, world } from "./helpers/world.js";

let refreshMode: "ok" | "fail" = "ok";
const refreshed: string[] = [];
const adapter: SocialAdapter = {
  platform: "instagram", capabilities: { ...NO_CAPABILITIES },
  oauth: { usesPkce: false, authorizationUrl: () => "", exchangeCode: async () => { throw new Error("x"); },
    refresh: async (cur) => { if (refreshMode === "fail") throw new PlatformError("permanent", "boom"); refreshed.push(cur); return { accessToken: `new-${refreshed.length}`, refreshToken: `new-${refreshed.length}`, expiresAt: new Date(Date.now() + 60 * 86400_000), scopes: [] }; } },
  fetchAccount: async () => { throw new Error("x"); },
};

describe("token maintenance", async () => {
  const t = await createTestApp([adapter]);
  afterAll(t.close);
  const cipher = await createCipher(TEST_KEYS);

  async function longLived(ws: string, owner: Awaited<ReturnType<typeof t.newUser>>, daysLeft: number) {
    const id = await seedAccount(t, ws, owner, "instagram", daysLeft * 86400);
    await t.db.query("UPDATE oauth_credentials SET refresh_token_enc = $2, updated_at = now() - interval '55 days' WHERE social_account_id = $1", [id, await cipher.encrypt("old-token", `cred:${id}`)]);
    return id;
  }

  it("keep-alive refreshes long-lived tokens close to expiry, and only those", async () => {
    const w = await world(t, []);
    const soon = await longLived(w.ws, w.owner, 5), far = await longLived(w.ws, w.owner, 40);
    const shortLived = await seedAccount(t, w.ws, w.owner, "instagram", 3600);            // 1h token: refreshed on demand, not by keep-alive
    await t.db.query("UPDATE oauth_credentials SET refresh_token_enc = $2 WHERE social_account_id = $1", [shortLived, await cipher.encrypt("r", `cred:${shortLived}`)]);
    refreshed.length = 0;
    expect(await t.deps.engine.tokens.keepAlive()).toEqual({ due: 1, refreshed: 1, failed: 0 });
    expect(refreshed).toEqual(["old-token"]);
    expect(await t.deps.accounts.getAccessToken(w.ws, soon)).toBe("new-1");
    expect((await t.db.query<{ n: number }>("SELECT EXTRACT(EPOCH FROM expires_at - now())::int / 86400 AS n FROM oauth_credentials WHERE social_account_id = $1", [soon])).rows[0]!.n).toBeGreaterThan(55);
    expect(await t.deps.accounts.getAccessToken(w.ws, far)).toBe("plain-access-token");   // untouched
    expect((await t.deps.engine.tokens.keepAlive()).due).toBe(0);                          // idempotent
  });

  it("a failed keep-alive never disconnects an account whose token is still valid", async () => {
    const w = await world(t, []);
    const id = await longLived(w.ws, w.owner, 4);
    refreshMode = "fail";
    expect(await t.deps.engine.tokens.keepAlive()).toMatchObject({ due: 1, refreshed: 0, failed: 1 });
    refreshMode = "ok";
    expect((await t.db.query("SELECT status FROM social_accounts WHERE id = $1", [id])).rows[0]).toEqual({ status: "active" });
    expect(await t.deps.accounts.getAccessToken(w.ws, id)).toBe("plain-access-token");
    expect((await t.deps.engine.tokens.keepAlive()).refreshed).toBe(1);                    // next run succeeds
  });

  it("a rotated refresh token is not lost when saving it fails once", async () => {
    const w = await world(t, []);
    const id = await longLived(w.ws, w.owner, 4);
    await t.db.query("CREATE SEQUENCE save_boom");
    await t.db.query(`CREATE FUNCTION save_boom() RETURNS trigger AS $$ BEGIN IF nextval('save_boom') = 1 THEN RAISE EXCEPTION 'connection terminated'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await t.db.query("CREATE TRIGGER save_boom BEFORE UPDATE ON oauth_credentials FOR EACH ROW EXECUTE FUNCTION save_boom()");
    try {
      refreshed.length = 0;
      const token = await t.deps.accounts.getAccessToken(w.ws, id, { forceRefresh: true });
      expect(token).toBe("new-1");
      const row = (await t.db.query<{ refresh_token_enc: string }>("SELECT refresh_token_enc FROM oauth_credentials WHERE social_account_id = $1", [id])).rows[0]!;
      expect(await cipher.decrypt(row.refresh_token_enc, `cred:${id}`)).toBe("new-1");   // the rotated token was kept
    } finally {
      await t.db.query("DROP TRIGGER save_boom ON oauth_credentials");
    }
  });

  it("after key rotation, stale credentials are re-encrypted with the new key, stay readable, and the job converges", async () => {
    const rotated = `2:${Buffer.alloc(32, 9).toString("base64")},${TEST_KEYS}`;       // new key first, old key kept for decryption
    const t2 = await createTestApp([adapter], { env: { TOKEN_ENC_KEYS: rotated } });
    const w = await world(t2, []);
    const id = await seedAccount(t2, w.ws, w.owner, "instagram");                    // helper encrypts with the OLD key (id 1)
    await t2.db.query("UPDATE oauth_credentials SET refresh_token_enc = $2 WHERE social_account_id = $1", [id, await cipher.encrypt("rt", `cred:${id}`)]);
    const enc = async () => (await t2.db.query<{ access_token_enc: string; refresh_token_enc: string }>("SELECT access_token_enc, refresh_token_enc FROM oauth_credentials WHERE social_account_id = $1", [id])).rows[0]!;
    expect((await enc()).access_token_enc.startsWith("1.")).toBe(true);
    expect(await t2.deps.engine.tokens.reencryptStale()).toMatchObject({ rewritten: 1 });
    const after = await enc();
    expect(after.access_token_enc.startsWith("2.")).toBe(true);
    expect(after.refresh_token_enc.startsWith("2.")).toBe(true);
    expect(await t2.deps.accounts.getAccessToken(w.ws, id)).toBe("plain-access-token");
    expect(await t2.deps.engine.tokens.reencryptStale()).toEqual({ rewritten: 0, failed: 0, remaining: 0 });   // converged: the old key can now be removed
    await t2.close();
  });

  it("one credential that cannot be decrypted is flagged for reconnect and never blocks the others", async () => {
    const rotated = `2:${Buffer.alloc(32, 9).toString("base64")},${TEST_KEYS}`;
    const t2 = await createTestApp([adapter], { env: { TOKEN_ENC_KEYS: rotated } });
    const w = await world(t2, []);
    const broken = await seedAccount(t2, w.ws, w.owner, "instagram");
    const good = await seedAccount(t2, w.ws, w.owner, "instagram");
    await t2.db.query("UPDATE oauth_credentials SET access_token_enc = '1.not-a-real-ciphertext' WHERE social_account_id = $1", [broken]);
    expect(await t2.deps.engine.tokens.reencryptStale()).toMatchObject({ rewritten: 1, failed: 1 });
    expect(await t2.deps.accounts.getAccessToken(w.ws, good)).toBe("plain-access-token");
    expect((await t2.db.query("SELECT status FROM social_accounts WHERE id = $1", [broken])).rows[0]).toEqual({ status: "needs_reauth" });
    expect(await t2.deps.engine.tokens.reencryptStale()).toMatchObject({ rewritten: 0, remaining: 0 });   // converged
    await t2.close();
  });
});

describe("refreshWithTimeout", () => {
  it("a refresh that never answers fails as retryable, so the credentials row lock is released", async () => {
    const hung = { oauth: { ...adapter.oauth, refresh: () => new Promise<never>(() => {}) } };
    await expect(refreshWithTimeout(hung, "rt", 20)).rejects.toMatchObject({ kind: "retryable" });
  });
});
