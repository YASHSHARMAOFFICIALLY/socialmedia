import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { Db } from "../../infrastructure/database/db.js";
import { AppError, badRequest, notFound } from "../../shared/errors/errors.js";
import { auditRepository } from "../audit/audit.repository.js";
import type { Actor, WorkspaceService } from "../workspaces/workspace.service.js";
import { DEFAULT_SCOPES, SCOPES, type Principal } from "./mcp.types.js";

const ACCESS_TTL_S = 3600;                       // device-flow access tokens live one hour; the CLI refreshes
const DEVICE_GRANT_TTL_S = 30 * 86400;           // refresh token lifetime (rotating)
const DEVICE_CODE_TTL_S = 600;
const POLL_INTERVAL_S = 5;
const REFRESH_GRACE_S = 120;                     // a rotated-out refresh token presented this soon is a concurrent client, not theft
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
const AUTH_CODE_TTL_S = 60;
const FORBIDDEN_SCHEMES = new Set(["javascript:", "data:", "file:", "vbscript:", "about:", "blob:", "http:", "ws:", "wss:", "ftp:"]);
/** https, loopback http (RFC 8252), or a private-use scheme for native apps. Never a scheme that executes or reads local content. */
export function validRedirectUri(raw: string): boolean {
  if (raw.length > 500) return false;
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.hash) return false;
  if (u.protocol === "https:") return !u.username && !u.password;
  if (u.protocol === "http:") return ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  return !FORBIDDEN_SCHEMES.has(u.protocol) && /^[a-z][a-z0-9+.-]*:\/\//.test(raw);
}
const pkceOk = (verifier: string, challenge: string) => {
  const a = Buffer.from(createHash("sha256").update(verifier).digest("base64url")), b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
};
export class OAuthError extends AppError {
  constructor(public readonly oauth: string, description: string, status = 400) { super(status, oauth.toUpperCase(), description); }
}

export interface AuthorizeQuery { client_id?: string | undefined; redirect_uri?: string | undefined; response_type?: string | undefined; code_challenge?: string | undefined; code_challenge_method?: string | undefined; scope?: string | undefined }

export function createMcpAuth(deps: { db: Db; workspaces: WorkspaceService }) {
  const { db, workspaces } = deps;
  const audit = (a: { id: string; requestId?: string | undefined }, workspaceId: string, action: string, entityId: string, metadata: Record<string, unknown> = {}) =>
    auditRepository.record(db, { workspaceId, actorId: a.id, action, entityType: "mcp_grant", entityId, metadata, ...(a.requestId ? { requestId: a.requestId } : {}) });

  async function mintAccess(q: Pick<Db, "query">, grantId: string, ttlS: number, prefix = "dsa") {
    const token = secret(prefix);
    await q.query("INSERT INTO mcp_access_tokens (token_hash, grant_id, expires_at) VALUES ($1,$2, now() + make_interval(secs => $3))", [sha256(token), grantId, ttlS]);
    return token;
  }

  /** Validates an authorization request. Errors about the client/redirect are never redirected (RFC 6749 4.1.2.1): they are shown to the user. */
  async function authorizeRequest(q: AuthorizeQuery) {
      const c = q.client_id ? (await db.query<{ name: string; redirect_uris: string[] }>("SELECT name, redirect_uris FROM mcp_clients WHERE client_id = $1", [q.client_id])).rows[0] : undefined;
      if (!c) throw badRequest("Unknown client");
      if (!q.redirect_uri || !c.redirect_uris.includes(q.redirect_uri)) throw badRequest("redirect_uri is not registered for this client");
      if (q.response_type !== "code") throw badRequest("response_type must be code");
      if (!q.code_challenge || q.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(q.code_challenge)) throw badRequest("PKCE with code_challenge_method=S256 is required");
      const requested = (q.scope ?? "").split(" ").filter(Boolean);
      const scopes = normalizeScopes(requested.length ? requested : DEFAULT_SCOPES);
      return { clientName: c.name, redirectUri: q.redirect_uri, codeChallenge: q.code_challenge, scopes };
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
      const scopes = normalizeScopes(i.scopes.length ? i.scopes : DEFAULT_SCOPES)   // least privilege by default; the portal link is opt-in;
      const device = secret("dsd"), code = userCode();
      await db.query("INSERT INTO mcp_device_codes (device_code_hash, user_code, client_name, scopes, expires_at) VALUES ($1,$2,$3,$4, now() + make_interval(secs => $5))", [sha256(device), code, i.clientName.slice(0, 80), scopes, DEVICE_CODE_TTL_S]);
      return { device_code: device, user_code: code, verification_uri: `${verificationBase}/mcp/device`, verification_uri_complete: `${verificationBase}/mcp/device`, expires_in: DEVICE_CODE_TTL_S, interval: POLL_INTERVAL_S };
    },
    async deviceInfo(code: string) {
      const r = (await db.query<{ client_name: string; scopes: string[] }>("SELECT client_name, scopes FROM mcp_device_codes WHERE user_code = $1 AND status = 'pending' AND expires_at > now()", [code.toUpperCase()])).rows[0];
      return r ? { clientName: r.client_name, scopes: r.scopes } : null;
    },
    async deviceDecide(a: Actor, code: string, workspaceId: string, approve: boolean) {
      await workspaces.authorize(a.id, workspaceId, "mcp:manage");                     // same bar as creating a PAT: a device grant is a long-lived credential
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
          `SELECT id, workspace_id, scopes, CASE WHEN refresh_hash = $1 THEN 'current' WHEN rotated_at > now() - make_interval(secs => ${REFRESH_GRACE_S}) THEN 'recent' ELSE 'previous' END AS matched FROM mcp_grants
            WHERE (refresh_hash = $1 OR $1 = ANY(old_refresh_hashes)) AND revoked_at IS NULL AND expires_at > now() FOR UPDATE`, [h])).rows[0];
        if (!g) return { err: "invalid" as const };
        if (g.matched === "recent") return { err: "stale" as const };   // two processes sharing one login raced; the loser must re-read the winner's tokens (no revocation)
        if (g.matched === "previous") {
          await q.query("UPDATE mcp_grants SET revoked_at = now() WHERE id = $1", [g.id]);
          await q.query("DELETE FROM mcp_access_tokens WHERE grant_id = $1", [g.id]);
          await auditRepository.record(q, { workspaceId: g.workspace_id, actorId: null, action: "mcp.grant.reuse_detected", entityType: "mcp_grant", entityId: g.id, metadata: {} });
          return { err: "reuse" as const };
        }
        const next = secret("dsr");
        await q.query("UPDATE mcp_grants SET old_refresh_hashes = (old_refresh_hashes || refresh_hash)[GREATEST(1, cardinality(old_refresh_hashes || refresh_hash) - 9):], refresh_hash = $2, rotated_at = now() WHERE id = $1", [g.id, sha256(next)]);
        const access = await mintAccess(q, g.id, ACCESS_TTL_S);
        return { ok: { access_token: access, refresh_token: next, token_type: "Bearer", expires_in: ACCESS_TTL_S, scope: g.scopes.join(" "), workspace_id: g.workspace_id } };
      });
      if ("ok" in out) return out.ok;
      throw new OAuthError("invalid_grant", out.err === "reuse" ? "Refresh token reuse detected; the session was revoked" : out.err === "stale" ? "Refresh token was just rotated by another client; use the newest one" : "Invalid refresh token");
    },

    // ---- Browser OAuth (authorization code + PKCE) with dynamic client registration (RFC 7591)
    async registerClient(i: { clientName: string; redirectUris: string[] }) {
      if (!i.redirectUris.length || i.redirectUris.length > 5 || !i.redirectUris.every(validRedirectUri)) throw new OAuthError("invalid_redirect_uri", "redirect_uris must be https, loopback http, or an app scheme (1 to 5)");
      const clientId = secret("dsc");
      const name = (i.clientName.trim() || "MCP client").slice(0, 80);
      await db.query("INSERT INTO mcp_clients (client_id, name, redirect_uris) VALUES ($1,$2,$3)", [clientId, name, i.redirectUris]);
      return { client_id: clientId, client_name: name, redirect_uris: i.redirectUris, token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] };
    },
    authorizeRequest,
    /** Returns where to send the browser: back to the client with a code (approve) or access_denied. */
    async authorizeDecide(a: Actor, q: AuthorizeQuery, state: string | undefined, workspaceId: string, approve: boolean) {
      const req = await authorizeRequest(q);
      await workspaces.authorize(a.id, workspaceId, "mcp:manage");                    // same bar as PATs and the device flow
      const url = new URL(req.redirectUri);
      if (state) url.searchParams.set("state", state.slice(0, 500));
      if (!approve) { url.searchParams.set("error", "access_denied"); return url.toString(); }
      const code = secret("dsx");
      await db.query("INSERT INTO mcp_auth_codes (code_hash, client_id, user_id, workspace_id, scopes, redirect_uri, code_challenge, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7, now() + make_interval(secs => $8))",
        [sha256(code), q.client_id, a.id, workspaceId, req.scopes, req.redirectUri, req.codeChallenge, AUTH_CODE_TTL_S]);
      await auditRepository.record(db, { workspaceId, actorId: a.id, action: "mcp.oauth.approved", entityType: "mcp_client", metadata: { client: req.clientName, scopes: req.scopes }, ...(a.requestId ? { requestId: a.requestId } : {}) });
      url.searchParams.set("code", code);
      return url.toString();
    },
    async exchangeCode(i: { code: string; clientId: string; redirectUri: string; codeVerifier: string }) {
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(i.codeVerifier)) throw new OAuthError("invalid_grant", "Invalid code_verifier");
      const out = await db.tx(async (q): Promise<{ err: string } | { ok: Record<string, unknown> }> => {
        const c = (await q.query<{ client_id: string; user_id: string; workspace_id: string; scopes: string[]; redirect_uri: string; code_challenge: string; used: boolean; expired: boolean; name: string }>(
          "SELECT c.client_id, c.user_id, c.workspace_id, c.scopes, c.redirect_uri, c.code_challenge, c.used_at IS NOT NULL AS used, c.expires_at <= now() AS expired, k.name FROM mcp_auth_codes c JOIN mcp_clients k ON k.client_id = c.client_id WHERE c.code_hash = $1 FOR UPDATE OF c", [sha256(i.code)])).rows[0];
        if (!c) return { err: "Unknown code" };
        await q.query("UPDATE mcp_auth_codes SET used_at = COALESCE(used_at, now()) WHERE code_hash = $1", [sha256(i.code)]);   // single use, even when validation fails
        if (c.used || c.expired || c.client_id !== i.clientId || c.redirect_uri !== i.redirectUri || !pkceOk(i.codeVerifier, c.code_challenge)) return { err: "Invalid, expired or already used code" };
        const refresh = secret("dsr");
        const g = (await q.query<{ id: string }>("INSERT INTO mcp_grants (user_id, workspace_id, kind, name, scopes, refresh_hash, expires_at) VALUES ($1,$2,'oauth',$3,$4,$5, now() + make_interval(secs => $6)) RETURNING id", [c.user_id, c.workspace_id, c.name, c.scopes, sha256(refresh), DEVICE_GRANT_TTL_S])).rows[0]!;
        const access = await mintAccess(q, g.id, ACCESS_TTL_S);
        await auditRepository.record(q, { workspaceId: c.workspace_id, actorId: c.user_id, action: "mcp.grant.created", entityType: "mcp_grant", entityId: g.id, metadata: { kind: "oauth", scopes: c.scopes } });
        return { ok: { access_token: access, refresh_token: refresh, token_type: "Bearer", expires_in: ACCESS_TTL_S, scope: c.scopes.join(" "), workspace_id: c.workspace_id } };
      });
      if ("err" in out) throw new OAuthError("invalid_grant", out.err);
      return out.ok;
    },

    async purge() {
      await db.query("DELETE FROM mcp_auth_codes WHERE expires_at < now() - interval '1 day'");
      await db.query("DELETE FROM mcp_clients k WHERE k.created_at < now() - interval '30 days' AND NOT EXISTS (SELECT 1 FROM mcp_grants g WHERE g.name = k.name AND g.kind = 'oauth' AND g.created_at > now() - interval '30 days')");
      await db.query("DELETE FROM mcp_access_tokens WHERE expires_at < now() - interval '1 day'");
      await db.query("DELETE FROM mcp_device_codes WHERE expires_at < now() - interval '1 day'");
      await db.query("DELETE FROM mcp_grants WHERE (expires_at < now() - interval '30 days') OR (revoked_at < now() - interval '30 days')");
    },
  };
}
export type McpAuth = ReturnType<typeof createMcpAuth>;
