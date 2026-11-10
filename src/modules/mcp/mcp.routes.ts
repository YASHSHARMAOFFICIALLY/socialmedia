import { createMcpHandler } from "@modelcontextprotocol/server";
import { Router, urlencoded, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import type { Logger } from "../../infrastructure/logger/logger.js";
import { validate } from "../../shared/middleware/validate.js";
import { OAuthError, sha256, type McpAuth } from "./mcp.auth.js";
import type { McpDeps } from "./mcp.deps.js";
import { buildMcpServer } from "./mcp.server.js";
import { SCOPES } from "./mcp.types.js";

const wsParam = z.object({ workspaceId: z.uuid() });
export const createTokenBody = z.object({ name: z.string().trim().min(1).max(80), scopes: z.array(z.enum(SCOPES)).min(1).default([...SCOPES]), expiresInDays: z.number().int().min(1).max(90).default(30) });
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
    res.json({ resource: `${baseUrl(req, d.publicUrl)}/mcp`, bearer_methods_supported: ["header"], scopes_supported: SCOPES, resource_name: "Distora MCP", device_authorization_endpoint: `${baseUrl(req, d.publicUrl)}/mcp/device`, token_endpoint: `${baseUrl(req, d.publicUrl)}/mcp/token` });
  };
  r.get(["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"], meta);

  r.all("/mcp", d.limit({ name: "mcp-ip", limit: 600, windowS: 60 }), async (req, res) => {
    const origin = req.header("origin");
    if (origin && !d.allowedOrigins.includes(origin)) { res.status(403).json({ error: { code: "ORIGIN_NOT_ALLOWED", message: "Origin not allowed", requestId: req.id } }); return; }
    const m = /^Bearer ([^\s]+)$/i.exec(req.header("authorization") ?? "");
    if (!m) return challenge(req, res);
    const p = await d.auth.verify(m[1]!);
    if (!p) return challenge(req, res, "invalid_token");
    // Per-credential limit (after authentication, so unauthenticated floods cannot burn a victim's budget).
    let limited = false;
    await d.limit({ name: "mcp-token", limit: 120, windowS: 60, key: () => sha256(m[1]!).slice(0, 16) })(req, { setHeader: () => res, status: () => { limited = true; return res; }, json: (b: unknown) => { res.status(429).json(b); } } as never, () => {});
    if (limited) return;
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
    if (b.grant_type === "urn:ietf:params:oauth:grant-type:device_code" && typeof b.device_code === "string") return d.auth.deviceToken(b.device_code);
    throw new OAuthError("unsupported_grant_type", "Use refresh_token or the device_code grant");
  }));

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
  r.post("/mcp/device/approve", d.authed, d.limit({ name: "mcp-device-approve", limit: 10, windowS: 60 }), form, async (req, res) => {
    const b = req.body ?? {};
    const ok = z.object({ user_code: z.string().min(4).max(20), workspace_id: z.uuid(), decision: z.enum(["approve", "deny"]) }).safeParse(b);
    if (!ok.success) { res.status(400).type("text").send("Invalid request"); return; }
    await d.auth.deviceDecide(actor(req), ok.data.user_code, ok.data.workspace_id, ok.data.decision === "approve");
    res.type("html").send(`<!doctype html><meta charset="utf-8"><title>Done</title><body style="font:16px system-ui;max-width:28rem;margin:3rem auto"><h1>${ok.data.decision === "approve" ? "Connected" : "Denied"}</h1><p>You can close this tab and return to the command line.</p></body>`);
  });
  return r;
}
