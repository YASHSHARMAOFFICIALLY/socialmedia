import { Router, type RequestHandler } from "express";
import { validate } from "../../shared/middleware/validate.js";
import { pageQuery } from "../../shared/utils/pagination.js";
import type { Platform } from "../../integrations/core/types.js";
import type { AccountService } from "./account.service.js";
import * as s from "./account.schemas.js";

const actor = (req: Parameters<RequestHandler>[0]) => ({ id: req.user!.id, email: req.user!.email, requestId: req.id });

export function accountRoutes(svc: AccountService, authn: RequestHandler, opts: { appUrl?: string | undefined }) {
  const r = Router();
  const p = (req: { params: unknown }) => req.params as { workspaceId: string; accountId: string; platform: Platform };

  // The platform redirects the user's browser here (top-level GET, so the SameSite=Lax session cookie is sent). The session must
  // belong to the user who started the flow, otherwise a victim could be tricked into attaching their account to an attacker's workspace.
  r.get("/oauth/:platform/callback", authn, validate({ params: s.callbackParams, query: s.callbackQuery }), async (req, res) => {
    const accts = await svc.handleCallback(p(req).platform, req.query as never, req.user!.id);
    if (opts.appUrl) res.redirect(302, `${opts.appUrl}/accounts?connected=${accts.map((a) => a.id).join(",")}`);
    else res.json({ data: accts.length === 1 ? accts[0] : accts });
  });

  r.get("/platforms", authn, (_req, res) => { res.json({ data: svc.platforms() }); });
  r.use("/workspaces/:workspaceId/accounts", authn);
  r.post("/workspaces/:workspaceId/accounts/connect", validate({ params: s.wsParam, body: s.connectBody }), async (req, res) => {
    res.json({ data: await svc.connect(actor(req), p(req).workspaceId, req.body.platform) });
  });
  r.post("/workspaces/:workspaceId/accounts/connect-credentials", validate({ params: s.wsParam, body: s.credentialsBody }), async (req, res) => {
    res.status(201).json({ data: await svc.connectWithCredentials(actor(req), p(req).workspaceId, req.body.platform, req.body.fields) });
  });
  r.get("/workspaces/:workspaceId/accounts", validate({ params: s.wsParam, query: pageQuery }), async (req, res) => {
    const q = req.query as unknown as { limit: number; cursor?: string };
    const { items, nextCursor } = await svc.list(actor(req), p(req).workspaceId, q.limit, q.cursor);
    res.json({ data: items, meta: { nextCursor } });
  });
  r.get("/workspaces/:workspaceId/accounts/:accountId", validate({ params: s.accountParams }), async (req, res) => {
    res.json({ data: await svc.get(actor(req), p(req).workspaceId, p(req).accountId) });
  });
  r.delete("/workspaces/:workspaceId/accounts/:accountId", validate({ params: s.accountParams }), async (req, res) => {
    await svc.disconnect(actor(req), p(req).workspaceId, p(req).accountId);
    res.status(204).end();
  });
  r.post("/workspaces/:workspaceId/accounts/:accountId/refresh", validate({ params: s.accountParams }), async (req, res) => {
    res.json({ data: await svc.refreshConnection(actor(req), p(req).workspaceId, p(req).accountId) });
  });
  return r;
}
