import type { Queryable } from "../../infrastructure/database/db.js";

// SAFE_COLS is the only column list ever returned to API layers: no credential columns, ever.
const SAFE = "id, workspace_id, platform, external_id, display_name, username, avatar_url, account_type, status, last_error, created_at, updated_at";
export interface AccountRow {
  id: string; workspace_id: string; platform: string; external_id: string; display_name: string; username: string | null;
  avatar_url: string | null; account_type: string; status: "active" | "needs_reauth" | "disconnected"; last_error: string | null;
  created_at: string; updated_at: string;
}
export interface CredentialRow {
  access_token_enc: string; refresh_token_enc: string | null; expires_at: string | null; refresh_expires_at: string | null; scopes: string[];
}

export const accountRepository = {
  createState: (q: Queryable, s: { stateHash: string; workspaceId: string; userId: string; platform: string; reconnectAccountId?: string; codeVerifierEnc?: string; expiresAt: Date }) =>
    q.query(
      "INSERT INTO oauth_states (state_hash, workspace_id, user_id, platform, reconnect_account_id, code_verifier_enc, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [s.stateHash, s.workspaceId, s.userId, s.platform, s.reconnectAccountId ?? null, s.codeVerifierEnc ?? null, s.expiresAt.toISOString()],
    ),
  // Atomic single-use consume: replayed or expired state matches no row.
  consumeState: async (q: Queryable, stateHash: string, platform: string) =>
    (await q.query<{ workspace_id: string; user_id: string; reconnect_account_id: string | null; code_verifier_enc: string | null }>(
      `UPDATE oauth_states SET used_at = now() WHERE state_hash = $1 AND platform = $2 AND used_at IS NULL AND expires_at > now()
        RETURNING workspace_id, user_id, reconnect_account_id, code_verifier_enc`, [stateHash, platform])).rows[0] ?? null,

  upsertAccount: async (q: Queryable, a: { workspaceId: string; platform: string; externalId: string; displayName: string; username?: string | undefined; avatarUrl?: string | undefined; accountType: string; metadata: unknown; userId: string }) =>
    (await q.query<AccountRow>(
      `INSERT INTO social_accounts (workspace_id, platform, external_id, display_name, username, avatar_url, account_type, metadata, connected_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (workspace_id, platform, external_id) DO UPDATE
         SET display_name = EXCLUDED.display_name, username = EXCLUDED.username, avatar_url = EXCLUDED.avatar_url,
             metadata = EXCLUDED.metadata, status = 'active', last_error = NULL, connected_by = EXCLUDED.connected_by
       RETURNING ${SAFE}`,
      [a.workspaceId, a.platform, a.externalId, a.displayName, a.username ?? null, a.avatarUrl ?? null, a.accountType, JSON.stringify(a.metadata), a.userId],
    )).rows[0]!,
  list: (q: Queryable, workspaceId: string, limit: number, after?: { createdAt: string; id: string }) =>
    q.query<AccountRow>(
      `SELECT ${SAFE} FROM social_accounts WHERE workspace_id = $1 AND status <> 'disconnected'
         AND ($2::timestamptz IS NULL OR (created_at, id) > ($2::timestamptz, $3::uuid)) ORDER BY created_at, id LIMIT $4`,
      [workspaceId, after?.createdAt ?? null, after?.id ?? null, limit + 1]),
  get: async (q: Queryable, workspaceId: string, id: string) =>
    (await q.query<AccountRow>(`SELECT ${SAFE} FROM social_accounts WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rows[0] ?? null,
  setStatus: (q: Queryable, workspaceId: string, id: string, status: AccountRow["status"], lastError?: string) =>
    q.query("UPDATE social_accounts SET status = $3, last_error = $4 WHERE workspace_id = $1 AND id = $2", [workspaceId, id, status, lastError ?? null]),

  saveCredentials: (q: Queryable, c: { accountId: string; workspaceId: string; accessEnc: string; refreshEnc: string | null; expiresAt?: Date | undefined; refreshExpiresAt?: Date | undefined; scopes: string[] }) =>
    q.query(
      `INSERT INTO oauth_credentials (social_account_id, workspace_id, access_token_enc, refresh_token_enc, expires_at, refresh_expires_at, scopes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (social_account_id) DO UPDATE SET access_token_enc = EXCLUDED.access_token_enc, refresh_token_enc = COALESCE(EXCLUDED.refresh_token_enc, oauth_credentials.refresh_token_enc),
         expires_at = EXCLUDED.expires_at, refresh_expires_at = EXCLUDED.refresh_expires_at, scopes = EXCLUDED.scopes, updated_at = now()`,
      [c.accountId, c.workspaceId, c.accessEnc, c.refreshEnc, c.expiresAt?.toISOString() ?? null, c.refreshExpiresAt?.toISOString() ?? null, c.scopes]),
  lockCredentials: async (q: Queryable, workspaceId: string, accountId: string) =>
    (await q.query<CredentialRow>(
      "SELECT access_token_enc, refresh_token_enc, expires_at, refresh_expires_at, scopes FROM oauth_credentials WHERE workspace_id = $1 AND social_account_id = $2 FOR UPDATE",
      [workspaceId, accountId])).rows[0] ?? null,
  deleteCredentials: (q: Queryable, workspaceId: string, accountId: string) =>
    q.query("DELETE FROM oauth_credentials WHERE workspace_id = $1 AND social_account_id = $2", [workspaceId, accountId]),
  replacePermissions: async (q: Queryable, workspaceId: string, accountId: string, granted: string[], required: string[]) => {
    await q.query("DELETE FROM platform_permissions WHERE workspace_id = $1 AND social_account_id = $2", [workspaceId, accountId]);
    for (const p of new Set([...granted, ...required]))
      await q.query("INSERT INTO platform_permissions (social_account_id, workspace_id, permission, granted) VALUES ($1,$2,$3,$4)", [accountId, workspaceId, p, granted.includes(p)]);
  },
  permissions: (q: Queryable, workspaceId: string, accountId: string) =>
    q.query<{ permission: string; granted: boolean; checked_at: string }>("SELECT permission, granted, checked_at FROM platform_permissions WHERE workspace_id = $1 AND social_account_id = $2 ORDER BY permission", [workspaceId, accountId]),

  /** Long-lived credentials (lifetime > 7 days, e.g. Instagram 60-day tokens) that expire soon and can be refreshed: kept alive by cron. */
  expiringLongLived: (q: Queryable, withinDays: number, limit: number) =>
    q.query<{ workspace_id: string; social_account_id: string }>(
      `SELECT c.workspace_id, c.social_account_id FROM oauth_credentials c JOIN social_accounts a ON a.id = c.social_account_id AND a.workspace_id = c.workspace_id
        WHERE a.status = 'active' AND c.refresh_token_enc IS NOT NULL AND c.expires_at > now() AND c.expires_at < now() + make_interval(days => $1)
          AND c.expires_at - c.updated_at > interval '7 days' ORDER BY c.expires_at LIMIT $2`, [withinDays, limit]),
  /** Credentials not written with the current key (after rotation). */
  staleKey: (q: Queryable, keyId: string, limit: number) =>
    q.query<{ workspace_id: string; social_account_id: string }>(
      `SELECT c.workspace_id, c.social_account_id FROM oauth_credentials c
         JOIN social_accounts a ON a.id = c.social_account_id AND a.status <> 'needs_reauth'
        WHERE left(c.access_token_enc, length($1) + 1) <> $1 || '.'
           OR (c.refresh_token_enc IS NOT NULL AND left(c.refresh_token_enc, length($1) + 1) <> $1 || '.')
        LIMIT $2`, [keyId, limit]),
  rewriteEncrypted: (q: Queryable, workspaceId: string, accountId: string, accessEnc: string, refreshEnc: string | null) =>
    q.query("UPDATE oauth_credentials SET access_token_enc = $3, refresh_token_enc = $4 WHERE workspace_id = $1 AND social_account_id = $2", [workspaceId, accountId, accessEnc, refreshEnc]),
};
