import { createHash, randomBytes, randomInt } from "node:crypto";
import type { Db } from "../../infrastructure/database/db.js";
import { AppError, badRequest, notFound } from "../../shared/errors/errors.js";
import { auditRepository } from "../audit/audit.repository.js";
import type { Actor, WorkspaceService } from "../workspaces/workspace.service.js";
import { SCOPES, type Principal } from "./mcp.types.js";

const ACCESS_TTL_S = 3600;                       // device-flow access tokens live one hour; the CLI refreshes
const DEVICE_GRANT_TTL_S = 30 * 86400;           // refresh token lifetime (rotating)
const DEVICE_CODE_TTL_S = 600;
const POLL_INTERVAL_S = 5;
const MAX_PAT_DAYS = 90;
const MAX_ACTIVE_PATS = 20;
// No 0/O/1/I/L: the code is read aloud and typed.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const secret = (prefix: string) => `${prefix}_${randomBytes(32).toString("base64url")}`;
const userCode = () => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("").replace(/^(.{4})(.{4})$/, "$1-$2");
const normalizeScopes = (scopes: readonly string[]) => {
  const bad = scopes.filter((s) => !(SCOPES as readonly string[]).includes(s));
  if (bad.length) throw badRequest(`Unknown scope: ${bad[0]}`);
  return [...new Set(scopes)];
};
export class OAuthError extends AppError {
  constructor(public readonly oauth: string, description: string, status = 400) { super(status, oauth.toUpperCase(), description); }
}

export function createMcpAuth(deps: { db: Db; workspaces: WorkspaceService }) {
  const { db, workspaces } = deps;
  const audit = (a: { id: string; requestId?: string | undefined }, workspaceId: string, action: string, entityId: string, metadata: Record<string, unknown> = {}) =>
    auditRepository.record(db, { workspaceId, actorId: a.id, action, entityType: "mcp_grant", entityId, metadata, ...(a.requestId ? { requestId: a.requestId } : {}) });

  async function mintAccess(q: Pick<Db, "query">, grantId: string, ttlS: number, prefix = "dsa") {
    const token = secret(prefix);
    await q.query("INSERT INTO mcp_access_tokens (token_hash, grant_id, expires_at) VALUES ($1,$2, now() + make_interval(secs => $3))", [sha256(token), grantId, ttlS]);
    return token;
  }

  return {
    /** Validate a bearer token. Returns null for anything unknown, expired or revoked (callers answer 401 without saying which). */
    async verify(token: string): Promise<(Principal & { expiresAt: number }) | null> {
      if (!/^ds[ap]_[A-Za-z0-9_-]{43}$/.test(token)) return null;
      const r = (await db.query<{ grant_id: string; user_id: string; workspace_id: string; scopes: string[]; exp: string; email: string }>(
        `SELECT g.id AS grant_id, g.user_id, g.workspace_id, g.scopes, extract(epoch FROM LEAST(t.expires_at, g.expires_at))::text AS exp, u.email
           FROM mcp_access_tokens t JOIN mcp_grants g ON g.id = t.grant_id JOIN "user" u ON u.id = g.user_id
          WHERE t.token_hash = $1 AND t.expires_at > now() AND g.expires_at > now() AND g.revoked_at IS NULL`, [sha256(token)])).rows[0];
      if (!r) return null;
      await db.query("UPDATE mcp_grants SET last_used_at = now() WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')", [r.grant_id]).catch(() => {});
      return { userId: r.user_id, email: r.email, scopes: r.scopes, workspaceId: r.workspace_id, clientId: r.grant_id, expiresAt: Math.floor(Number(r.exp)) };
    },

    // ---- Personal access tokens (for clients that take a static Authorization header)
    async createPat(a: Actor, workspaceId: string, i: { name: string; scopes: readonly string[]; expiresInDays: number }) {
      await workspaces.authorize(a.id, workspaceId, "mcp:manage");
      if (i.expiresInDays < 1 || i.expiresInDays > MAX_PAT_DAYS) throw badRequest(`Tokens last 1 to ${MAX_PAT_DAYS} days`);
      const scopes = normalizeScopes(i.scopes);
      const active = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM mcp_grants WHERE workspace_id = $1 AND kind = 'pat' AND revoked_at IS NULL AND expires_at > now()", [workspaceId])).rows[0]!.n;
      if (active >= MAX_ACTIVE_PATS) throw new AppError(409, "TOKEN_LIMIT", `At most ${MAX_ACTIVE_PATS} active tokens per workspace`);
      return db.tx(async (q) => {
        const g = (await q.query<{ id: string; expires_at: string }>("INSERT INTO mcp_grants (user_id, workspace_id, kind, name, scopes, expires_at) VALUES ($1,$2,'pat',$3,$4, now() + make_interval(days => $5)) RETURNING id, expires_at", [a.id, workspaceId, i.name, scopes, i.expiresInDays])).rows[0]!;
        const token = await mintAccess(q, g.id, i.expiresInDays * 86400, "dsp");
        await auditRepository.record(q, { workspaceId, actorId: a.id, action: "mcp.grant.created", entityType: "mcp_grant", entityId: g.id, metadata: { kind: "pat", scopes }, ...(a.requestId ? { requestId: a.requestId } : {}) });
        return { id: g.id, token, scopes, expiresAt: g.expires_at };   // the only time the raw token exists
      });
    },
    /** Admins see every grant of the workspace; everyone else only their own. */
    async list(a: Actor, workspaceId: string) {
      const role = await workspaces.authorize(a.id, workspaceId, "workspace:read");
      const all = role === "owner" || role === "admin";
      return (await db.query<{ id: string; user_id: string; kind: string; name: string; scopes: string[]; expires_at: string; revoked_at: string | null; last_used_at: string | null; created_at: string }>(
        "SELECT id, user_id, kind, name, scopes, expires_at, revoked_at, last_used_at, created_at FROM mcp_grants WHERE workspace_id = $1 AND ($2::boolean OR user_id = $3) ORDER BY created_at DESC LIMIT 100", [workspaceId, all, a.id])).rows
        .map((g) => ({ id: g.id, userId: g.user_id, kind: g.kind, name: g.name, scopes: g.scopes, expiresAt: g.expires_at, revokedAt: g.revoked_at, lastUsedAt: g.last_used_at, createdAt: g.created_at }));
    },
    async revoke(a: Actor, workspaceId: string, grantId: string) {
      const role = await workspaces.authorize(a.id, workspaceId, "workspace:read");
      const all = role === "owner" || role === "admin";
      const r = await db.query("UPDATE mcp_grants SET revoked_at = now() WHERE id = $1 AND workspace_id = $2 AND revoked_at IS NULL AND ($3::boolean OR user_id = $4)", [grantId, workspaceId, all, a.id]);
      if (!r.rowCount) throw notFound("Token");
      await db.query("DELETE FROM mcp_access_tokens WHERE grant_id = $1", [grantId]);
      await audit(a, workspaceId, "mcp.grant.revoked", grantId);
    },

    // ---- Device authorization (RFC 8628), for the local CLI
    async deviceStart(i: { clientName: string; scopes: readonly string[] }, verificationBase: string) {
      const scopes = normalizeScopes(i.scopes.length ? i.scopes : SCOPES);
      const device = secret("dsd"), code = userCode();
      await db.query("INSERT INTO mcp_device_codes (device_code_hash, user_code, client_name, scopes, expires_at) VALUES ($1,$2,$3,$4, now() + make_interval(secs => $5))", [sha256(device), code, i.clientName.slice(0, 80), scopes, DEVICE_CODE_TTL_S]);
      return { device_code: device, user_code: code, verification_uri: `${verificationBase}/mcp/device`, verification_uri_complete: `${verificationBase}/mcp/device?user_code=${code}`, expires_in: DEVICE_CODE_TTL_S, interval: POLL_INTERVAL_S };
    },
    async deviceInfo(code: string) {
      const r = (await db.query<{ client_name: string; scopes: string[] }>("SELECT client_name, scopes FROM mcp_device_codes WHERE user_code = $1 AND status = 'pending' AND expires_at > now()", [code.toUpperCase()])).rows[0];
      return r ? { clientName: r.client_name, scopes: r.scopes } : null;
    },
    async deviceDecide(a: Actor, code: string, workspaceId: string, approve: boolean) {
      await workspaces.authorize(a.id, workspaceId, "workspace:read");                 // the approver must really belong to the workspace
      const r = await db.query("UPDATE mcp_device_codes SET status = $2, user_id = $3, workspace_id = $4 WHERE user_code = $1 AND status = 'pending' AND expires_at > now()", [code.toUpperCase(), approve ? "approved" : "denied", a.id, workspaceId]);
      if (!r.rowCount) throw notFound("Code");
      await auditRepository.record(db, { workspaceId, actorId: a.id, action: approve ? "mcp.device.approved" : "mcp.device.denied", entityType: "mcp_device", metadata: {}, ...(a.requestId ? { requestId: a.requestId } : {}) });
    },
    async deviceToken(deviceCode: string) {
      const h = sha256(deviceCode);
      // Errors are RETURNED from the transaction (not thrown) so the poll timestamp commits and slow_down works.
      const out = await db.tx(async (q): Promise<{ err: OAuthError } | { ok: Record<string, unknown> }> => {
        const d = (await q.query<{ id: string; status: string; user_id: string | null; workspace_id: string | null; scopes: string[]; client_name: string; expired: boolean; too_fast: boolean }>(
          "SELECT id, status, user_id, workspace_id, scopes, client_name, expires_at <= now() AS expired, (last_polled_at IS NOT NULL AND last_polled_at > now() - make_interval(secs => $2)) AS too_fast FROM mcp_device_codes WHERE device_code_hash = $1 FOR UPDATE", [h, POLL_INTERVAL_S - 1])).rows[0];
        if (!d || d.status === "consumed") return { err: new OAuthError("invalid_grant", "Unknown or already used device code") };
        if (d.expired) return { err: new OAuthError("expired_token", "The code expired; start again") };
        await q.query("UPDATE mcp_device_codes SET last_polled_at = now() WHERE id = $1", [d.id]);
        if (d.status === "denied") return { err: new OAuthError("access_denied", "The request was denied") };
        if (d.status === "pending") return { err: new OAuthError(d.too_fast ? "slow_down" : "authorization_pending", "Waiting for approval") };
        await q.query("UPDATE mcp_device_codes SET status = 'consumed' WHERE id = $1", [d.id]);
        const refresh = secret("dsr");
        const g = (await q.query<{ id: string }>("INSERT INTO mcp_grants (user_id, workspace_id, kind, name, scopes, refresh_hash, expires_at) VALUES ($1,$2,'device',$3,$4,$5, now() + make_interval(secs => $6)) RETURNING id", [d.user_id, d.workspace_id, d.client_name, d.scopes, sha256(refresh), DEVICE_GRANT_TTL_S])).rows[0]!;
        const access = await mintAccess(q, g.id, ACCESS_TTL_S);
        await auditRepository.record(q, { workspaceId: d.workspace_id, actorId: d.user_id, action: "mcp.grant.created", entityType: "mcp_grant", entityId: g.id, metadata: { kind: "device", scopes: d.scopes } });
        return { ok: { access_token: access, refresh_token: refresh, token_type: "Bearer", expires_in: ACCESS_TTL_S, scope: d.scopes.join(" "), workspace_id: d.workspace_id } };
      });
      if ("err" in out) throw out.err;
      return out.ok;
    },
    /** Rotating refresh. Presenting an already-rotated token means it leaked: the whole grant is revoked. */
    async refresh(refreshToken: string) {
      const h = sha256(refreshToken);
      const out = await db.tx(async (q) => {
        const g = (await q.query<{ id: string; workspace_id: string; scopes: string[]; matched: string }>(
          `SELECT id, workspace_id, scopes, CASE WHEN refresh_hash = $1 THEN 'current' ELSE 'previous' END AS matched FROM mcp_grants
            WHERE (refresh_hash = $1 OR prev_refresh_hash = $1) AND revoked_at IS NULL AND expires_at > now() FOR UPDATE`, [h])).rows[0];
        if (!g) return { err: "invalid" as const };
        if (g.matched === "previous") {
          await q.query("UPDATE mcp_grants SET revoked_at = now() WHERE id = $1", [g.id]);
          await q.query("DELETE FROM mcp_access_tokens WHERE grant_id = $1", [g.id]);
          await auditRepository.record(q, { workspaceId: g.workspace_id, actorId: null, action: "mcp.grant.reuse_detected", entityType: "mcp_grant", entityId: g.id, metadata: {} });
          return { err: "reuse" as const };
        }
        const next = secret("dsr");
        await q.query("UPDATE mcp_grants SET prev_refresh_hash = refresh_hash, refresh_hash = $2 WHERE id = $1", [g.id, sha256(next)]);
        const access = await mintAccess(q, g.id, ACCESS_TTL_S);
        return { ok: { access_token: access, refresh_token: next, token_type: "Bearer", expires_in: ACCESS_TTL_S, scope: g.scopes.join(" "), workspace_id: g.workspace_id } };
      });
      if ("ok" in out) return out.ok;
      throw new OAuthError("invalid_grant", out.err === "reuse" ? "Refresh token reuse detected; the session was revoked" : "Invalid refresh token");
    },

    async purge() {
      await db.query("DELETE FROM mcp_access_tokens WHERE expires_at < now() - interval '1 day'");
      await db.query("DELETE FROM mcp_device_codes WHERE expires_at < now() - interval '1 day'");
      await db.query("DELETE FROM mcp_grants WHERE (expires_at < now() - interval '30 days') OR (revoked_at < now() - interval '30 days')");
    },
  };
}
export type McpAuth = ReturnType<typeof createMcpAuth>;
