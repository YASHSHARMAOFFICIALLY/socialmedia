import { timingSafeEqual } from "node:crypto";
import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { Db } from "../../infrastructure/database/db.js";
import { badRequest, notFound } from "../../shared/errors/errors.js";
import { validate } from "../../shared/middleware/validate.js";
import { auditRepository } from "../audit/audit.repository.js";
import type { BillingPayments } from "./billing.payments.js";

const eq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };   // compare BYTE lengths: non-ASCII input must not throw
const price = z.object({ currency: z.enum(["INR", "USD"]), interval: z.enum(["month", "year"]), amountMinor: z.number().int().min(0).max(100_000_000_00) });
const entitlement = z.object({ feature: z.string().regex(/^[a-z_]{2,40}$/), kind: z.enum(["flag", "value", "count", "metered"]), limit: z.number().int().min(0).nullable() });
export const newVersionBody = z.object({ prices: z.array(price).max(8), entitlements: z.array(entitlement).min(1).max(40) })
  .refine((b) => new Set(b.prices.map((p) => `${p.currency}/${p.interval}`)).size === b.prices.length, "Duplicate price")
  .refine((b) => new Set(b.entitlements.map((e) => e.feature)).size === b.entitlements.length, "Duplicate entitlement");

/**
 * Operator endpoints (OPS_TOKEN, constant-time compare; 404 when no token is configured). Deliberately not in the public OpenAPI:
 * they change prices and replay money events, so they are reachable only by whoever holds the ops secret.
 */
export function billingAdminRoutes(d: { db: Db; pay: BillingPayments; opsToken?: string | undefined }) {
  const r = Router();
  const ops: RequestHandler = (req, res, next) => {
    if (!d.opsToken) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found", requestId: req.id } }); return; }
    const given = /^Bearer (.+)$/.exec(req.header("authorization") ?? "")?.[1] ?? "";
    if (!eq(given, d.opsToken)) { res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Authentication required", requestId: req.id } }); return; }
    next();
  };
  r.use("/admin/billing", ops);
  const audit = (req: { id?: string }, action: string, entityId: string, metadata: Record<string, unknown>) => auditRepository.record(d.db, { workspaceId: null, actorId: null, action, entityType: "billing_admin", entityId, metadata, ...(req.id ? { requestId: req.id } : {}) });

  r.get("/admin/billing/webhook-events", validate({ query: z.object({ status: z.enum(["received", "failed", "processed", "ignored"]).default("failed"), limit: z.coerce.number().int().min(1).max(100).default(50) }) }), async (req, res) => {
    const q = req.query as unknown as { status: string; limit: number };
    res.json({ data: (await d.db.query("SELECT id, provider, event_id, event_type, status, attempts, last_error, received_at, processed_at FROM billing_webhook_events WHERE status = $1 ORDER BY received_at DESC LIMIT $2", [q.status, q.limit])).rows });
  });
  /** Operator overview: who is on which plan, expected monthly recurring revenue per currency, and whether webhook processing is healthy. Aggregates only, no customer data. */
  r.get("/admin/billing/summary", async (_req, res) => {
    const subs = (await d.db.query<{ plan: string; status: string; currency: string; n: number }>(
      `SELECT p.key AS plan, s.status, s.currency, count(*)::int AS n FROM billing_subscriptions s JOIN billing_plan_versions v ON v.id = s.plan_version_id JOIN billing_plans p ON p.id = v.plan_id
        WHERE s.status <> 'canceled' GROUP BY 1,2,3 ORDER BY 1,2,3`)).rows;
    // MRR = monthly price for monthly subscriptions + yearly price / 12 for yearly ones, for subscriptions that currently grant access and are not ending.
    const mrr = (await d.db.query<{ currency: string; mrr_minor: string }>(
      `SELECT s.currency, round(sum(CASE s.interval WHEN 'year' THEN pr.amount_minor / 12.0 ELSE pr.amount_minor END))::text AS mrr_minor
         FROM billing_subscriptions s JOIN billing_prices pr ON pr.plan_version_id = s.plan_version_id AND pr.currency = s.currency AND pr.interval = s.interval
        WHERE s.status IN ('active','trialing','past_due') AND NOT s.cancel_at_period_end GROUP BY 1 ORDER BY 1`)).rows;
    const hooks = (await d.db.query<{ status: string; n: number }>("SELECT status, count(*)::int AS n FROM billing_webhook_events WHERE received_at > now() - interval '7 days' GROUP BY 1")).rows;
    res.json({ data: { subscriptions: subs, mrrMinorByCurrency: Object.fromEntries(mrr.map((m) => [m.currency, Number(m.mrr_minor)])), webhookEventsLast7Days: Object.fromEntries(hooks.map((h) => [h.status, h.n])) } });
  });
  r.post("/admin/billing/webhook-events/:id/retry", validate({ params: z.object({ id: z.uuid() }) }), async (req, res) => {
    const id = (req.params as { id: string }).id;
    const u = await d.db.query("UPDATE billing_webhook_events SET status = 'received', attempts = 0, next_attempt_at = now(), last_error = NULL WHERE id = $1 AND status IN ('failed','received','ignored')", [id]);
    if (!u.rowCount) throw notFound("Event");
    await audit(req, "billing.admin.webhook_retry", id, {});
    res.json({ data: await d.pay.sweep() });
  });
  r.put("/admin/billing/plans/:plan/prices/:currency/:interval/provider-ref", validate({ params: z.object({ plan: z.string().regex(/^[a-z0-9_]{2,40}$/), currency: z.enum(["INR", "USD"]), interval: z.enum(["month", "year"]) }), body: z.object({ provider: z.string().regex(/^[a-z]{2,20}$/), ref: z.string().min(1).max(200) }) }), async (req, res) => {
    const p = req.params as { plan: string; currency: string; interval: string };
    const b = req.body as { provider: string; ref: string };
    const u = await d.db.query(
      `UPDATE billing_prices SET provider_refs = provider_refs || jsonb_build_object($4::text, $5::text)
        WHERE currency = $2 AND interval = $3 AND plan_version_id = (SELECT v.id FROM billing_plan_versions v JOIN billing_plans pl ON pl.id = v.plan_id WHERE pl.key = $1 AND v.active)`, [p.plan, p.currency, p.interval, b.provider, b.ref]);
    if (!u.rowCount) throw notFound("Price");
    await audit(req, "billing.admin.provider_ref_set", `${p.plan}/${p.currency}/${p.interval}`, { provider: b.provider });
    res.status(204).end();
  });
  /** Prices/limits change by publishing a NEW version. Existing subscribers stay on theirs; new checkouts use the new one. */
  r.post("/admin/billing/plans/:plan/versions", validate({ params: z.object({ plan: z.string().regex(/^[a-z0-9_]{2,40}$/) }), body: newVersionBody }), async (req, res) => {
    const key = (req.params as { plan: string }).plan, b = req.body as z.infer<typeof newVersionBody>;
    if (key === "free" && b.prices.length) throw badRequest("The free plan has no prices");
    if (!b.entitlements.every((e) => (e.kind === "flag" ? e.limit === 0 || e.limit === 1 : true))) throw badRequest("Flag entitlements must be 0 or 1");
    const out = await d.db.tx(async (q) => {
      const plan = (await q.query<{ id: string }>("SELECT id FROM billing_plans WHERE key = $1 FOR UPDATE", [key])).rows[0];
      if (!plan) throw notFound("Plan");
      const version = (await q.query<{ v: number }>("SELECT COALESCE(max(version),0)::int + 1 AS v FROM billing_plan_versions WHERE plan_id = $1", [plan.id])).rows[0]!.v;
      await q.query("UPDATE billing_plan_versions SET active = false WHERE plan_id = $1", [plan.id]);
      const vid = (await q.query<{ id: string }>("INSERT INTO billing_plan_versions (plan_id, version) VALUES ($1,$2) RETURNING id", [plan.id, version])).rows[0]!.id;
      for (const p of b.prices) await q.query("INSERT INTO billing_prices (plan_version_id, currency, interval, amount_minor) VALUES ($1,$2,$3,$4)", [vid, p.currency, p.interval, p.amountMinor]);
      for (const e of b.entitlements) await q.query("INSERT INTO billing_entitlements (plan_version_id, feature_key, kind, limit_value) VALUES ($1,$2,$3,$4)", [vid, e.feature, e.kind, e.limit]);
      return version;
    });
    await audit(req, "billing.admin.plan_version_published", key, { version: out });
    res.status(201).json({ data: { plan: key, version: out, note: "Provider product refs must be set again for the new version's prices" } });
  });
  return r;
}
