import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { validate } from "../../shared/middleware/validate.js";
import type { BillingPayments } from "./billing.payments.js";
import type { BillingService } from "./billing.service.js";

export const wsParam = z.object({ workspaceId: z.uuid() });
export const checkoutBody = z.object({ plan: z.enum(["starter", "pro", "agency"]), currency: z.enum(["INR", "USD"]), interval: z.enum(["month", "year"]).default("month") });
const actor = (req: Parameters<RequestHandler>[0]) => ({ id: req.user!.id, email: req.user!.email, requestId: req.id });

export function billingRoutes(svc: BillingService, pay: BillingPayments, authn: RequestHandler) {
  const r = Router();
  const ws = (req: { params: unknown }) => (req.params as { workspaceId: string }).workspaceId;
  r.get("/billing/plans", authn, async (_req, res) => { res.json({ data: await svc.plans() }); });
  r.get("/workspaces/:workspaceId/billing", authn, validate({ params: wsParam }), async (req, res) => { res.json({ data: await svc.overview(actor(req), ws(req)) }); });
  r.post("/workspaces/:workspaceId/billing/checkout", authn, validate({ params: wsParam, body: checkoutBody }), async (req, res) => { res.status(201).json({ data: await pay.checkout(actor(req), ws(req), req.body) }); });
  r.get("/workspaces/:workspaceId/billing/payments", authn, validate({ params: wsParam, query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }) }), async (req, res) => { res.json({ data: await svc.payments(actor(req), ws(req), (req.query as unknown as { limit: number }).limit) }); });
  r.post("/workspaces/:workspaceId/billing/portal", authn, validate({ params: wsParam }), async (req, res) => { res.status(201).json({ data: await pay.portal(actor(req), ws(req)) }); });
  r.post("/workspaces/:workspaceId/billing/cancel", authn, validate({ params: wsParam }), async (req, res) => { res.json({ data: await pay.cancel(actor(req), ws(req)) }); });
  return r;
}

/** Provider -> us. Public by necessity: trust comes only from the signature, verified over the raw body before anything is stored. */
export function billingWebhookRoutes(pay: BillingPayments) {
  const r = Router();
  r.post("/webhooks/dodo", async (req, res) => {
    const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
    if (!raw) { res.status(400).end(); return; }
    const h = (n: string) => req.header(n);
    const out = await pay.receive({ "webhook-id": h("webhook-id"), "webhook-timestamp": h("webhook-timestamp"), "webhook-signature": h("webhook-signature") }, raw);
    res.status(200).json({ received: true, duplicate: out.duplicate });
  });
  return r;
}
