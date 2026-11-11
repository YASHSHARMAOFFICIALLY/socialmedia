import { createMcpHandler } from "@modelcontextprotocol/server";
import { Router, urlencoded, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import type { Logger } from "../../infrastructure/logger/logger.js";
import { validate } from "../../shared/middleware/validate.js";
import { OAuthError, sha256, type McpAuth } from "./mcp.auth.js";
import type { McpDeps } from "./mcp.deps.js";
import { buildMcpServer } from "./mcp.server.js";
import { DEFAULT_SCOPES, SCOPES } from "./mcp.types.js";

const wsParam = z.object({ workspaceId: z.uuid() });
export const createTokenBody = z.object({ name: z.string().trim().min(1).max(80), scopes: z.array(z.enum(SCOPES)).min(1).default([...DEFAULT_SCOPES]), expiresInDays: z.number().int().min(1).max(90).default(30) });
const actor = (req: Request) => ({ id: req.user!.id, email: req.user!.email, requestId: req.id });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const baseUrl = (req: Request, configured?: string) => configured ?? `${req.protocol}://${req.get("host")}`;

export interface McpRouteDeps { auth: McpAuth; deps: McpDeps; log: Logger; publicUrl?: string | undefined; allowedOrigins: string[]; authed: RequestHandler; limit: (o: { name: string; limit: number; windowS: number; key?: (req: Request) => string | undefined }) => RequestHandler }

export function mcpRoutes(d: McpRouteDeps) {
  const r = Router();
  // Stateless: a fresh server per request, built for the verified caller. JSON responses (no SSE) keep it runtime-agnostic.
  const handler = createMcpHandler(({ authInfo }) => buildMcpServer(d.deps, authInfo!.extra as never), { responseMode: "json" });

  const challenge = (req: Request, res: Response, error?: string) => {
    res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${baseUrl(req, d.publicUrl)}/.well-known/oauth-protected-resource/mcp"${error ? `, error="${error}"` : ""}`);
    res.status(401).json({ error: { code: "UNAUTHORIZED", message: "A valid bearer token is required", requestId: req.id } });
  };

  // RFC 9728 protected resource metadata. Tokens come from the device flow or a personal access token; there is no browser OAuth redirect flow.
  const meta: RequestHandler = (req, res) => {
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({ resource: `${baseUrl(req, d.publicUrl)}/mcp`, bearer_methods_supported: ["header"], scopes_supported: SCOPES, resource_name: "Distora MCP", authorization_servers: [baseUrl(req, d.publicUrl)], device_authorization_endpoint: `${baseUrl(req, d.publicUrl)}/mcp/device`, token_endpoint: `${baseUrl(req, d.publicUrl)}/mcp/token` });
  };
  r.get(["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"], meta);
  // RFC 8414 authorization server metadata (the API is its own authorization server).
  r.get(["/.well-known/oauth-authorization-server", "/.well-known/oauth-authorization-server/mcp"], (req, res) => {
    const b = baseUrl(req, d.publicUrl);
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({ issuer: b, authorization_endpoint: `${b}/mcp/authorize`, token_endpoint: `${b}/mcp/token`, registration_endpoint: `${b}/mcp/register`, device_authorization_endpoint: `${b}/mcp/device`,
      response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token", "urn:ietf:params:oauth:grant-type:device_code"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"], scopes_supported: SCOPES });
  });

  const bearer = (req: Request) => /^Bearer ([^\s]+)$/i.exec(req.header("authorization") ?? "")?.[1];
  const authenticate: RequestHandler = async (req, res, next) => {
    const origin = req.header("origin");
    if (origin && !d.allowedOrigins.includes(origin)) { res.status(403).json({ error: { code: "ORIGIN_NOT_ALLOWED", message: "Origin not allowed", requestId: req.id } }); return; }
    const tok = bearer(req);
    if (!tok) return challenge(req, res);
    const p = await d.auth.verify(tok);
    if (!p) return challenge(req, res, "invalid_token");
    res.locals["mcpPrincipal"] = p;
    next();
  };
  // Per-credential limit runs after authentication, so unauthenticated floods cannot burn a victim's budget.
  const perToken = d.limit({ name: "mcp-token", limit: 120, windowS: 60, key: (req) => sha256(bearer(req) ?? "").slice(0, 16) });
  r.all("/mcp", d.limit({ name: "mcp-ip", limit: 600, windowS: 60 }), authenticate, perToken, async (req, res) => {
    const p = res.locals["mcpPrincipal"] as NonNullable<Awaited<ReturnType<typeof d.auth.verify>>>;
    const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string" && k !== "host" && k !== "authorization" && k !== "content-length") headers.set(k, v);
    const request = new Request(`${baseUrl(req, d.publicUrl)}/mcp`, { method: req.method, headers, ...(raw && req.method !== "GET" && req.method !== "HEAD" ? { body: new Uint8Array(raw) } : {}) });
    const out = await handler.fetch(request, { authInfo: { token: "redacted", clientId: p.clientId!, scopes: [...p.scopes], expiresAt: p.expiresAt, extra: { userId: p.userId, email: p.email, scopes: p.scopes, workspaceId: p.workspaceId, clientId: p.clientId } } });
    res.status(out.status);
    out.headers.forEach((v, k) => { if (k !== "content-length" && k !== "set-cookie") res.setHeader(k, v); });
    res.send(Buffer.from(await out.arrayBuffer()));
  });

  // ---- token management (cookie session; documented in OpenAPI)
  const tokens = "/workspaces/:workspaceId/mcp/tokens";
  const ws = (req: Request) => (req.params as { workspaceId: string }).workspaceId;
  r.post(tokens, d.authed, validate({ params: wsParam, body: createTokenBody }), async (req, res) => { res.status(201).json({ data: await d.auth.createPat(actor(req), ws(req), req.body) }); });
  r.get(tokens, d.authed, validate({ params: wsParam }), async (req, res) => { res.json({ data: await d.auth.list(actor(req), ws(req)) }); });
  r.delete(`${tokens}/:grantId`, d.authed, validate({ params: wsParam.extend({ grantId: z.uuid() }) }), async (req, res) => { await d.auth.revoke(actor(req), ws(req), (req.params as { grantId: string }).grantId); res.status(204).end(); });

  // ---- device authorization (RFC 8628) for the local CLI. Start/token are public and rate limited by IP.
  const oauth = (fn: (req: Request) => Promise<unknown>): RequestHandler => async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try { res.json(await fn(req)); }
    catch (e) { if (e instanceof OAuthError) { res.status(400).json({ error: e.oauth, error_description: e.message }); return; } throw e; }
  };
  const form = urlencoded({ extended: false, limit: "10kb" });
  r.post("/mcp/device", d.limit({ name: "mcp-device-start", limit: 20, windowS: 60 }), oauth(async (req) =>
    d.auth.deviceStart({ clientName: String(req.body?.client_name ?? "MCP client"), scopes: Array.isArray(req.body?.scopes) ? req.body.scopes.map(String) : String(req.body?.scope ?? "").split(" ").filter(Boolean) }, baseUrl(req, d.publicUrl))));
  r.post("/mcp/token", d.limit({ name: "mcp-token-endpoint", limit: 60, windowS: 60 }), form, oauth(async (req) => {
    const b = req.body ?? {};
    if (b.grant_type === "refresh_token" && typeof b.refresh_token === "string") return d.auth.refresh(b.refresh_token);
    if (b.grant_type === "authorization_code" && [b.code, b.client_id, b.redirect_uri, b.code_verifier].every((v) => typeof v === "string")) return d.auth.exchangeCode({ code: b.code, clientId: b.client_id, redirectUri: b.redirect_uri, codeVerifier: b.code_verifier });
    if (b.grant_type === "urn:ietf:params:oauth:grant-type:device_code" && typeof b.device_code === "string") return d.auth.deviceToken(b.device_code);
    throw new OAuthError("unsupported_grant_type", "Use authorization_code (with PKCE), refresh_token or the device_code grant");
  }));

  // ---- Dynamic client registration (RFC 7591): public clients only, IP rate limited.
  r.post("/mcp/register", d.limit({ name: "mcp-register", limit: 10, windowS: 60 }), async (req, res) => {
    try {
      const b = req.body ?? {};
      const out = await d.auth.registerClient({ clientName: typeof b.client_name === "string" ? b.client_name : "", redirectUris: Array.isArray(b.redirect_uris) ? b.redirect_uris.map(String) : [] });
      res.setHeader("Cache-Control", "no-store");
      res.status(201).json(out);
    } catch (e) { if (e instanceof OAuthError) { res.status(400).json({ error: e.oauth, error_description: e.message }); return; } throw e; }
  });

  // ---- Authorization endpoint (browser): consent page + decision. Needs the user's existing sign-in cookie.
  const sameOrigin: RequestHandler = (req, res, next) => {
    const o = req.header("origin");
    if (o && o !== new URL(baseUrl(req, d.publicUrl)).origin) { res.status(403).type("text").send("Cross-site request refused"); return; }
    next();
  };
  const pageHead = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`;
  const pageStyle = `style="font:16px system-ui;max-width:28rem;margin:3rem auto;padding:0 1rem"`;
  const authQuery = (b: Record<string, unknown>) => ({ client_id: String(b["client_id"] ?? ""), redirect_uri: String(b["redirect_uri"] ?? ""), response_type: String(b["response_type"] ?? "code"), code_challenge: String(b["code_challenge"] ?? ""), code_challenge_method: String(b["code_challenge_method"] ?? ""), scope: String(b["scope"] ?? "") });
  r.get("/mcp/authorize", d.authed, async (req, res) => {
    res.type("html").setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
    res.setHeader("Cache-Control", "no-store");
    try {
      const q = authQuery(req.query as Record<string, unknown>);
      const info = await d.auth.authorizeRequest(q);
      const wss = (await d.deps.db.query<{ id: string; name: string }>("SELECT w.id, w.name FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id WHERE m.user_id = $1 AND m.role IN ('owner','admin') ORDER BY w.name LIMIT 50", [req.user!.id])).rows;
      const hidden = Object.entries({ ...q, scope: info.scopes.join(" "), state: String(req.query["state"] ?? "") }).map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(String(v))}">`).join("");
      res.send(`${pageHead}<title>Authorize ${esc(info.clientName)}</title><body ${pageStyle}><h1>Let “${esc(info.clientName)}” connect?</h1><p>It will be able to: ${info.scopes.map(esc).join(", ")}. It acts with your own permissions in the workspace you pick, and you can revoke it at any time.</p>
${wss.length ? `<form method="post" action="/mcp/authorize">${hidden}<label>Workspace <select name="workspace_id">${wss.map((w) => `<option value="${esc(w.id)}">${esc(w.name)}</option>`).join("")}</select></label>
<p><button name="decision" value="approve">Allow</button> <button name="decision" value="deny">Deny</button></p></form>` : `<p>Only workspace owners and admins can connect clients. You have no such workspace.</p>`}</body>`);
    } catch (e) {
      res.status(400).send(`${pageHead}<title>Cannot authorize</title><body ${pageStyle}><h1>Cannot authorize</h1><p>${esc(e instanceof Error ? e.message : "Invalid request")}</p></body>`);
    }
  });
  r.post("/mcp/authorize", d.authed, sameOrigin, d.limit({ name: "mcp-authorize", limit: 20, windowS: 60 }), form, async (req, res) => {
    const b = req.body ?? {};
    const ok = z.object({ workspace_id: z.uuid(), decision: z.enum(["approve", "deny"]) }).safeParse(b);
    res.type("html").setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
    if (!ok.success) { res.status(400).send(`${pageHead}<title>Invalid</title><body ${pageStyle}><h1>Invalid request</h1></body>`); return; }
    const to = await d.auth.authorizeDecide(actor(req), authQuery(b), typeof b.state === "string" && b.state ? b.state : undefined, ok.data.workspace_id, ok.data.decision === "approve");
    // A 200 page with a refresh (not a 302): browsers apply form-action to redirects, which would block custom-scheme and cross-origin callbacks.
    res.send(`${pageHead}<meta http-equiv="refresh" content="0;url=${esc(to)}"><title>Returning</title><body ${pageStyle}><h1>${ok.data.decision === "approve" ? "Connected" : "Denied"}</h1><p><a href="${esc(to)}">Return to the application</a></p></body>`);
  });

  // Approval page: needs the browser's existing sign-in cookie. Plain server-rendered HTML, no frontend required.
  r.get("/mcp/device", d.authed, async (req, res) => {
    const code = String(req.query["user_code"] ?? "");
    const info = code ? await d.auth.deviceInfo(code) : null;
    const wss = (await d.deps.db.query<{ id: string; name: string }>("SELECT w.id, w.name FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id WHERE m.user_id = $1 ORDER BY w.name LIMIT 50", [req.user!.id])).rows;
    res.type("html").setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
    res.send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect a client</title><body style="font:16px system-ui;max-width:28rem;margin:3rem auto;padding:0 1rem">${
      info ? `<h1>Connect “${esc(info.clientName)}”</h1><p>Code <b>${esc(code.toUpperCase())}</b>. This client will be able to: ${info.scopes.map(esc).join(", ")}. It acts with your own permissions and can be revoked at any time.</p>
<form method="post" action="/mcp/device/approve"><input type="hidden" name="user_code" value="${esc(code)}"><label>Workspace <select name="workspace_id">${wss.map((w) => `<option value="${esc(w.id)}">${esc(w.name)}</option>`).join("")}</select></label>
<p><button name="decision" value="approve">Approve</button> <button name="decision" value="deny">Deny</button></p></form>`
      : `<h1>Code not found</h1><p>The code is invalid or expired. Start again from the command line.</p>`}</body>`);
  });
  r.post("/mcp/device/approve", d.authed, sameOrigin, d.limit({ name: "mcp-device-approve", limit: 10, windowS: 60 }), form, async (req, res) => {
    const b = req.body ?? {};
    const ok = z.object({ user_code: z.string().min(4).max(20), workspace_id: z.uuid(), decision: z.enum(["approve", "deny"]) }).safeParse(b);
    if (!ok.success) { res.status(400).type("text").send("Invalid request"); return; }
    await d.auth.deviceDecide(actor(req), ok.data.user_code, ok.data.workspace_id, ok.data.decision === "approve");
    res.type("html").send(`<!doctype html><meta charset="utf-8"><title>Done</title><body style="font:16px system-ui;max-width:28rem;margin:3rem auto"><h1>${ok.data.decision === "approve" ? "Connected" : "Denied"}</h1><p>You can close this tab and return to the command line.</p></body>`);
  });
  return r;
}
