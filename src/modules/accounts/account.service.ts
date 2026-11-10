import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { Config } from "../../config/env.js";
import type { Db, Queryable } from "../../infrastructure/database/db.js";
import type { Cipher } from "../../infrastructure/encryption/cipher.js";
import { PlatformError } from "../../integrations/core/errors.js";
import type { AdapterRegistry } from "../../integrations/core/registry.js";
import type { ConnectedAccount, Platform } from "../../integrations/core/types.js";
import { AppError, badRequest, notFound } from "../../shared/errors/errors.js";
import { decodeCursor, page } from "../../shared/utils/pagination.js";
import { auditRepository } from "../audit/audit.repository.js";
import type { Actor, WorkspaceService } from "../workspaces/workspace.service.js";
import { accountRepository as repo } from "./account.repository.js";

const STATE_TTL_MS = 10 * 60 * 1000;
const REFRESH_SKEW_MS = 5 * 60 * 1000;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const cursorSchema = z.object({ createdAt: z.string(), id: z.string() });
const verifierChallenge = (v: string) => createHash("sha256").update(v).digest("base64url");

export function createAccountService(deps: { db: Db; cfg: Config; cipher: Cipher | null; registry: AdapterRegistry; workspaces: WorkspaceService; log?: { error(o: object, m: string): void } }) {
  const { db, cfg, registry, workspaces } = deps;
  const cipher = () => {
    if (!deps.cipher) throw new AppError(503, "ENCRYPTION_NOT_CONFIGURED", "TOKEN_ENC_KEYS is not configured");
    return deps.cipher;
  };
  const redirectUri = (platform: Platform) => `${cfg.BETTER_AUTH_URL ?? ""}/oauth/${platform}/callback`;
  const aad = (accountId: string) => `cred:${accountId}`;

  async function beginAuthorization(a: Actor, workspaceId: string, platform: Platform, reconnectAccountId?: string) {
    const adapter = registry.get(platform);
    const state = randomBytes(32).toString("base64url");
    let verifier: string | undefined;
    if (adapter.oauth.usesPkce) verifier = randomBytes(48).toString("base64url");
    await repo.createState(db, {
      stateHash: sha256(state), workspaceId, userId: a.id, platform,
      ...(reconnectAccountId ? { reconnectAccountId } : {}),
      ...(verifier ? { codeVerifierEnc: await cipher().encrypt(verifier, `state:${sha256(state)}`) } : {}),
      expiresAt: new Date(Date.now() + STATE_TTL_MS),
    });
    return adapter.oauth.authorizationUrl({ state, redirectUri: redirectUri(platform), ...(verifier ? { codeChallenge: verifierChallenge(verifier) } : {}) });
  }

  /** Decrypts, refreshing first when near expiry. Row-locked so concurrent callers can't double-refresh. */
  async function getAccessToken(workspaceId: string, accountId: string, opts: { forceRefresh?: boolean } = {}): Promise<string> {
    return db.tx(async (q) => {
      const acct = await repo.get(q, workspaceId, accountId);
      if (!acct || acct.status === "disconnected") throw notFound("Account");
      const cred = await repo.lockCredentials(q, workspaceId, accountId);
      if (!cred) throw new PlatformError("auth_expired", "No credentials stored");
      const expiresAt = cred.expires_at ? new Date(cred.expires_at).getTime() : Infinity;
      if (!opts.forceRefresh && expiresAt - Date.now() > REFRESH_SKEW_MS) return cipher().decrypt(cred.access_token_enc, aad(accountId));

      const adapter = registry.get(acct.platform);
      if (cred.refresh_token_enc && adapter.oauth.refresh) {
        try {
          const t = await adapter.oauth.refresh(await cipher().decrypt(cred.refresh_token_enc, aad(accountId)));
          await repo.saveCredentials(q, {
            accountId, workspaceId, accessEnc: await cipher().encrypt(t.accessToken, aad(accountId)),
            refreshEnc: t.refreshToken ? await cipher().encrypt(t.refreshToken, aad(accountId)) : null,
            expiresAt: t.expiresAt, refreshExpiresAt: t.refreshExpiresAt, scopes: t.scopes.length ? t.scopes : cred.scopes,
          });
          return t.accessToken;
        } catch (e) {
          if (!(e instanceof PlatformError) || e.kind !== "permanent" && e.kind !== "auth_expired") throw e; // transient: caller retries
        }
      }
      // A keep-alive refresh that fails must not kill an account whose current token is still valid: the next run (or the user) retries.
      if (opts.forceRefresh && expiresAt > Date.now()) throw new PlatformError("retryable", "Token refresh failed; the current token is still valid");
      await repo.setStatus(q, workspaceId, accountId, "needs_reauth", "Access token expired and cannot be refreshed");
      throw new PlatformError("auth_expired", "Access token expired; account needs re-authorization");
    }).catch(async (e) => {
      // The status flip above is rolled back with the tx when we throw; persist it separately.
      if (e instanceof PlatformError && e.kind === "auth_expired") await repo.setStatus(db, workspaceId, accountId, "needs_reauth", e.message).catch((err) => deps.log?.error({ err, accountId }, "could not flag account as needing re-authorization"));
      throw e;
    });
  }

  /** Upserts one account and its encrypted credentials; `reconnectId` (when set) must match the account the platform returned. */
  async function store(tx: Queryable, workspaceId: string, userId: string, platform: Platform, c: ConnectedAccount, reconnectId?: string | null) {
    const { profile, tokens } = c;
    const acct = await repo.upsertAccount(tx, {
      workspaceId, platform, externalId: profile.externalId, displayName: profile.displayName,
      username: profile.username, avatarUrl: profile.avatarUrl, accountType: profile.accountType, metadata: profile.metadata ?? {}, userId,
    });
    await repo.saveCredentials(tx, {
      accountId: acct.id, workspaceId,
      accessEnc: await cipher().encrypt(tokens.accessToken, aad(acct.id)),
      refreshEnc: tokens.refreshToken ? await cipher().encrypt(tokens.refreshToken, aad(acct.id)) : null,
      expiresAt: tokens.expiresAt, refreshExpiresAt: tokens.refreshExpiresAt, scopes: tokens.scopes,
    });
    await repo.replacePermissions(tx, workspaceId, acct.id, tokens.scopes, []);
    await auditRepository.record(tx, { workspaceId, actorId: userId, action: "account.connected", entityType: "social_account", entityId: acct.id, metadata: { platform } });
    return acct;
  }

  return {
    getAccessToken,

    /**
     * Called by verified platform callbacks (user removed the app / asked for data deletion). Not user-authorized: the platform's signed
     * request IS the authority. Deletes credentials, disconnects every matching account, and optionally purges collected analytics.
     */
    async disconnectByExternalId(platform: string, externalId: string, purgeData: boolean) {
      return db.tx(async (q) => {
        const rows = (await q.query<{ id: string; workspace_id: string }>("SELECT id, workspace_id FROM social_accounts WHERE platform = $1 AND external_id = $2 AND status <> 'disconnected'", [platform, externalId])).rows;
        const all = (await q.query<{ id: string; workspace_id: string }>("SELECT id, workspace_id FROM social_accounts WHERE platform = $1 AND external_id = $2", [platform, externalId])).rows;
        for (const a of rows) {
          await repo.deleteCredentials(q, a.workspace_id, a.id);
          await repo.setStatus(q, a.workspace_id, a.id, "disconnected", "Removed on the platform");
          if (!purgeData) await auditRepository.record(q, { workspaceId: a.workspace_id, actorId: null, action: "account.deauthorized", entityType: "social_account", entityId: a.id, metadata: { platform } });
        }
        if (purgeData) for (const a of all) await auditRepository.record(q, { workspaceId: a.workspace_id, actorId: null, action: "account.data_deleted", entityType: "social_account", entityId: a.id, metadata: { platform } });
        if (purgeData && all.length) {
          await q.query("DELETE FROM analytics_targets WHERE social_account_id = ANY($1::uuid[])", [all.map((a) => a.id)]);   // cascades to snapshots, metrics, aggregates
          await q.query("UPDATE social_accounts SET display_name = 'Deleted account', username = NULL, avatar_url = NULL, metadata = '{}' WHERE id = ANY($1::uuid[])", [all.map((a) => a.id)]);
        }
        return all.length;
      });
    },

    /** Cron: refresh long-lived tokens (Instagram: 60 days, refreshable only while still valid) before they expire from disuse. */
    async keepAlive(limit = 20) {
      const due = (await repo.expiringLongLived(db, 10, limit)).rows;
      let refreshed = 0, failed = 0;
      for (const d of due) {
        try { await getAccessToken(d.workspace_id, d.social_account_id, { forceRefresh: true }); refreshed++; } catch { failed++; }
      }
      return { due: due.length, refreshed, failed };
    },

    /** Cron, after TOKEN_ENC_KEYS rotation: rewrite credentials still encrypted with an old key. Idempotent; the old key can be removed once it returns 0. */
    async reencryptStale(limit = 50) {
      const c = cipher();
      const rows = (await repo.staleKey(db, c.keyId, limit)).rows;
      for (const r of rows) {
        await db.tx(async (q) => {
          const cred = await repo.lockCredentials(q, r.workspace_id, r.social_account_id);
          if (!cred) return;
          const id = aad(r.social_account_id);
          await repo.rewriteEncrypted(q, r.workspace_id, r.social_account_id, await c.encrypt(await c.decrypt(cred.access_token_enc, id), id), cred.refresh_token_enc ? await c.encrypt(await c.decrypt(cred.refresh_token_enc, id), id) : null);
        });
      }
      return { rewritten: rows.length, remaining: rows.length === limit ? "more" : 0 };
    },
    platforms: () => registry.list(),

    async connect(a: Actor, workspaceId: string, platform: Platform) {
      await workspaces.authorize(a.id, workspaceId, "accounts:manage");
      return { authorizationUrl: await beginAuthorization(a, workspaceId, platform) };
    },

    /** Public endpoint (browser redirect from the platform). Trust comes only from the single-use state row. */
    async handleCallback(platform: Platform, q: { code?: string | undefined; state?: string | undefined; error?: string | undefined }) {
      if (!q.state) throw badRequest("Missing state");
      const adapter = registry.get(platform);
      const stateHash = sha256(q.state);
      const st = await repo.consumeState(db, stateHash, platform); // consumed even if the user denied: state is single-use
      if (!st) throw badRequest("Invalid or expired state");
      if (q.error || !q.code) throw badRequest(`Authorization was not granted${q.error ? `: ${q.error}` : ""}`);

      const verifier = st.code_verifier_enc ? await cipher().decrypt(st.code_verifier_enc, `state:${stateHash}`) : undefined;
      const tokens = await adapter.oauth.exchangeCode({ code: q.code, redirectUri: redirectUri(platform), ...(verifier ? { codeVerifier: verifier } : {}) });
      let found = adapter.listAccounts ? await adapter.listAccounts(tokens) : [{ profile: await adapter.fetchAccount(tokens.accessToken), tokens }];
      if (st.reconnect_account_id) { // reconnecting one account: keep only it, never the other accounts of a multi-account grant
        const target = await repo.get(db, st.workspace_id, st.reconnect_account_id);
        found = found.filter((f) => f.profile.externalId === target?.external_id);
        if (found.length === 0) throw badRequest("Authorized account does not match the account being reconnected");
      }
      if (found.length === 0) throw badRequest("The authorization granted access to no accounts");

      return db.tx(async (tx) => {
        // The initiating user must still be allowed to manage accounts (membership/role may have changed in the meantime).
        await workspaces.authorize(st.user_id, st.workspace_id, "accounts:manage", tx);
        const saved = [];
        for (const f of found) saved.push(await store(tx, st.workspace_id, st.user_id, platform, f));
        return saved;
      });
    },

    /** Credentials-mode connect (Bluesky, Mastodon, Telegram): the platform validates the secret, we store it encrypted like OAuth tokens. */
    async connectWithCredentials(a: Actor, workspaceId: string, platform: Platform, fields: Record<string, string>) {
      await workspaces.authorize(a.id, workspaceId, "accounts:manage");
      const adapter = registry.get(platform);
      if (!adapter.credentials) throw badRequest(`${platform} connects with OAuth, not credentials`);
      for (const f of adapter.credentials.fields) if (!fields[f.name]?.trim()) throw badRequest(`Missing field '${f.name}'`);
      const connected = await adapter.credentials.connect(fields);
      return db.tx((tx) => store(tx, workspaceId, a.id, platform, connected));
    },

    async list(a: Actor, workspaceId: string, limit: number, cursor?: string) {
      await workspaces.authorize(a.id, workspaceId, "accounts:read");
      const rows = (await repo.list(db, workspaceId, limit, decodeCursor(cursor, cursorSchema))).rows;
      return page(rows, limit, (r) => ({ createdAt: r.created_at, id: r.id }));
    },

    async get(a: Actor, workspaceId: string, accountId: string) {
      await workspaces.authorize(a.id, workspaceId, "accounts:read");
      const acct = await repo.get(db, workspaceId, accountId);
      if (!acct) throw notFound("Account");
      return { ...acct, permissions: (await repo.permissions(db, workspaceId, accountId)).rows };
    },

    async disconnect(a: Actor, workspaceId: string, accountId: string) {
      await workspaces.authorize(a.id, workspaceId, "accounts:manage");
      await db.tx(async (q) => {
        if (!(await repo.get(q, workspaceId, accountId))) throw notFound("Account");
        await repo.deleteCredentials(q, workspaceId, accountId);
        await repo.setStatus(q, workspaceId, accountId, "disconnected");
        await auditRepository.record(q, { workspaceId, actorId: a.id, action: "account.disconnected", entityType: "social_account", entityId: accountId });
      });
    },

    /** Refreshes tokens when the platform allows it; otherwise returns a fresh authorization URL (re-consent). */
    async refreshConnection(a: Actor, workspaceId: string, accountId: string) {
      await workspaces.authorize(a.id, workspaceId, "accounts:manage");
      const acct = await repo.get(db, workspaceId, accountId);
      if (!acct || acct.status === "disconnected") throw notFound("Account");
      const adapter = registry.get(acct.platform);
      if (adapter.oauth.refresh) {
        try {
          await getAccessToken(workspaceId, accountId); // refreshes only if near expiry
          return { status: "ok" as const };
        } catch (e) {
          if (!(e instanceof PlatformError) || e.kind !== "auth_expired") throw e;
        }
      }
      return { status: "reauthorization_required" as const, authorizationUrl: await beginAuthorization(a, workspaceId, acct.platform as Platform, accountId) };
    },
  };
}
export type AccountService = ReturnType<typeof createAccountService>;
