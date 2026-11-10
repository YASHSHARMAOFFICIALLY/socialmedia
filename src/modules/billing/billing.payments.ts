import type { Db } from "../../infrastructure/database/db.js";
import type { Logger } from "../../infrastructure/logger/logger.js";
import { ProviderError, WebhookSignatureError, type PaymentProvider, type ProviderSubStatus } from "../../integrations/payments/types.js";
import { AppError, badRequest } from "../../shared/errors/errors.js";
import { auditRepository } from "../audit/audit.repository.js";
import type { Actor, WorkspaceService } from "../workspaces/workspace.service.js";
import { transition, type SubEvent, type SubStatus } from "./billing.state.js";

const MAX_ATTEMPTS = 8;
const EVENT_FOR: Record<ProviderSubStatus, SubEvent | null> = { pending: null, active: "activated", past_due: "payment_failed", on_hold: "suspended", canceled: "canceled", expired: "expired", unknown: null };
const providerErr = (e: unknown) => e instanceof ProviderError ? new AppError(e.status === 404 ? 404 : 502, "PAYMENT_PROVIDER_ERROR", e.message) : e;

interface LocalSub { id: string; workspace_id: string; status: SubStatus; plan_version_id: string; currency: string; interval: string; provider_subscription_id: string | null }

export function createBillingPayments(deps: { db: Db; workspaces: WorkspaceService; provider: PaymentProvider | null; log: Logger; returnUrl: string }) {
  const { db, workspaces, provider, log } = deps;
  const need = () => { if (!provider) throw new AppError(503, "PAYMENTS_NOT_CONFIGURED", "Payments are not configured"); return provider; };

  /** Brings our subscription row in line with the provider's AUTHORITATIVE state (fetched with our API key, not taken from the webhook body). */
  async function syncSubscription(providerSubId: string): Promise<"processed" | "ignored"> {
    const p = need();
    const ps = await p.getSubscription(providerSubId);
    const bindId = ps.metadata["billing_subscription_id"];
    return db.tx(async (q) => {
      let sub = (await q.query<LocalSub>("SELECT id, workspace_id, status, plan_version_id, currency, interval, provider_subscription_id FROM billing_subscriptions WHERE provider = $1 AND provider_subscription_id = $2 FOR UPDATE", [p.name, ps.id])).rows[0];
      if (!sub && bindId && /^[0-9a-f-]{36}$/.test(bindId)) {
        // First sighting: attach to the row WE created at checkout (the id came from metadata we set, and the provider confirmed it with our key).
        sub = (await q.query<LocalSub>("SELECT id, workspace_id, status, plan_version_id, currency, interval, provider_subscription_id FROM billing_subscriptions WHERE id = $1 AND provider_subscription_id IS NULL AND status <> 'canceled' FOR UPDATE", [bindId])).rows[0];
      }
      if (!sub) return "ignored";
      // The product the customer bought must be the product we priced for this plan; otherwise never grant it.
      const price = (await q.query<{ ref: string | null }>("SELECT provider_refs->>$4 AS ref FROM billing_prices WHERE plan_version_id = $1 AND currency = $2 AND interval = $3", [sub.plan_version_id, sub.currency, sub.interval, p.name])).rows[0];
      if (!price?.ref || price.ref !== ps.productId) { log.warn({ subscriptionId: sub.id }, "billing: provider product does not match plan; ignored"); return "ignored"; }
      const event = EVENT_FOR[ps.status];
      const next = event ? transition(sub.status, event) : null;
      if (!next && sub.provider_subscription_id) return "ignored";                    // nothing valid to apply (duplicate, late, or terminal)
      await q.query(
        `UPDATE billing_subscriptions SET status = $2, provider = $3, provider_subscription_id = $4, provider_customer_id = COALESCE($5, provider_customer_id),
                current_period_end = COALESCE($6::timestamptz, current_period_end), cancel_at_period_end = $7,
                canceled_at = CASE WHEN $2 = 'canceled' THEN COALESCE(canceled_at, now()) ELSE canceled_at END WHERE id = $1`,
        [sub.id, next ?? sub.status, p.name, ps.id, ps.customerId, ps.currentPeriodEnd, ps.cancelAtPeriodEnd]);
      await auditRepository.record(q, { workspaceId: sub.workspace_id, actorId: null, action: "billing.subscription.synced", entityType: "subscription", entityId: sub.id, metadata: { from: sub.status, to: next ?? sub.status, provider: p.name } });
      return "processed";
    });
  }

  async function handle(row: { id: string; payload: { subscriptionId: string | null; payment: { id: string; status: "succeeded" | "failed"; amountMinor: number | null; currency: string | null } | null } }) {
    const ev = row.payload;
    let result: "processed" | "ignored" = "ignored";
    if (ev.subscriptionId) result = await syncSubscription(ev.subscriptionId);
    if (ev.payment && ev.subscriptionId) {
      const s = (await db.query<{ id: string; workspace_id: string }>("SELECT id, workspace_id FROM billing_subscriptions WHERE provider = $1 AND provider_subscription_id = $2", [need().name, ev.subscriptionId])).rows[0];
      if (s) {
        await db.query("INSERT INTO billing_payments (workspace_id, subscription_id, provider, provider_payment_id, status, amount_minor, currency) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING",
          [s.workspace_id, s.id, need().name, ev.payment.id, ev.payment.status, ev.payment.amountMinor, ev.payment.currency && /^[A-Z]{3}$/.test(ev.payment.currency) ? ev.payment.currency : null]);
        result = "processed";
      }
    }
    return result;
  }

  /** Runs one stored event. Safe to run twice: sync reads authoritative state and transitions are idempotent. */
  async function process(id: string) {
    const row = (await db.query<{ id: string; payload: never; status: string }>("SELECT id, payload, status FROM billing_webhook_events WHERE id = $1", [id])).rows[0];
    if (!row || row.status === "processed" || row.status === "ignored") return;
    try {
      const result = await handle(row);
      await db.query("UPDATE billing_webhook_events SET status = $2, processed_at = now(), last_error = NULL WHERE id = $1", [id, result]);
    } catch (err) {
      const reason = err instanceof ProviderError || err instanceof AppError ? err.message : "processing error";
      log.error({ eventRowId: id, reason }, "billing webhook processing failed");
      await db.query("UPDATE billing_webhook_events SET status = 'failed', last_error = $2 WHERE id = $1", [id, reason.slice(0, 200)]);
    }
  }

  return {
    /** Public webhook intake: verify signature on the raw body, store once, acknowledge. Processing never blocks the 200. */
    async receive(headers: Record<string, string | undefined>, raw: Buffer): Promise<{ duplicate: boolean }> {
      const p = need();
      let ev;
      try { ev = p.verifyWebhook(headers, raw); } catch (e) { if (e instanceof WebhookSignatureError) throw new AppError(401, "UNAUTHORIZED", "Invalid webhook signature"); throw e; }
      const ins = await db.query<{ id: string }>(
        "INSERT INTO billing_webhook_events (provider, event_id, event_type, payload) VALUES ($1,$2,$3,$4) ON CONFLICT (provider, event_id) DO NOTHING RETURNING id",
        [p.name, ev.id, ev.type.slice(0, 80), JSON.stringify({ subscriptionId: ev.subscriptionId, payment: ev.payment })]);
      if (!ins.rows[0]) return { duplicate: true };
      await process(ins.rows[0].id);                                                   // best effort; the sweeper retries failures
      return { duplicate: false };
    },

    async checkout(a: Actor, workspaceId: string, i: { plan: string; currency: "INR" | "USD"; interval: "month" | "year" }) {
      await workspaces.authorize(a.id, workspaceId, "billing:manage");
      const p = need();
      const price = (await db.query<{ plan_version_id: string; ref: string | null }>(
        `SELECT v.id AS plan_version_id, pr.provider_refs->>$4 AS ref FROM billing_plans pl JOIN billing_plan_versions v ON v.plan_id = pl.id AND v.active
           JOIN billing_prices pr ON pr.plan_version_id = v.id AND pr.currency = $2 AND pr.interval = $3 WHERE pl.key = $1`, [i.plan, i.currency, i.interval, p.name])).rows[0];
      if (!price) throw badRequest("Unknown plan, currency or interval");
      if (!price.ref) throw new AppError(409, "PLAN_NOT_PURCHASABLE", "This plan is not available for purchase yet");
      const subId = await db.tx(async (q) => {
        const live = (await q.query<{ id: string; status: SubStatus }>("SELECT id, status FROM billing_subscriptions WHERE workspace_id = $1 AND status <> 'canceled' FOR UPDATE", [workspaceId])).rows[0];
        if (live && live.status !== "incomplete") throw new AppError(409, "ALREADY_SUBSCRIBED", "This workspace already has a subscription");
        if (live) { await q.query("UPDATE billing_subscriptions SET plan_version_id = $2, currency = $3, interval = $4 WHERE id = $1", [live.id, price.plan_version_id, i.currency, i.interval]); return live.id; }
        return (await q.query<{ id: string }>("INSERT INTO billing_subscriptions (workspace_id, plan_version_id, status, currency, interval) VALUES ($1,$2,'incomplete',$3,$4) RETURNING id", [workspaceId, price.plan_version_id, i.currency, i.interval])).rows[0]!.id;
      });
      let session;
      try { session = await p.createCheckout({ productId: price.ref, email: a.email, returnUrl: deps.returnUrl, metadata: { billing_subscription_id: subId, workspace_id: workspaceId } }); }
      catch (e) { throw providerErr(e); }
      await auditRepository.record(db, { workspaceId, actorId: a.id, action: "billing.checkout.started", entityType: "subscription", entityId: subId, metadata: { plan: i.plan, currency: i.currency, interval: i.interval }, ...(a.requestId ? { requestId: a.requestId } : {}) });
      return { checkoutUrl: session.url, subscriptionId: subId };
    },

    /** Cancel at period end. The local flag changes only after the provider accepted it. */
    async cancel(a: Actor, workspaceId: string) {
      await workspaces.authorize(a.id, workspaceId, "billing:manage");
      const p = need();
      const sub = (await db.query<{ id: string; provider_subscription_id: string | null; status: SubStatus }>("SELECT id, provider_subscription_id, status FROM billing_subscriptions WHERE workspace_id = $1 AND status <> 'canceled'", [workspaceId])).rows[0];
      if (!sub || !sub.provider_subscription_id || sub.status === "incomplete") throw new AppError(409, "NO_ACTIVE_SUBSCRIPTION", "No active subscription to cancel");
      try { await p.cancelAtPeriodEnd(sub.provider_subscription_id); } catch (e) { throw providerErr(e); }
      await db.tx(async (q) => {
        await q.query("UPDATE billing_subscriptions SET cancel_at_period_end = true WHERE id = $1", [sub.id]);
        await auditRepository.record(q, { workspaceId, actorId: a.id, action: "billing.subscription.cancel_requested", entityType: "subscription", entityId: sub.id, ...(a.requestId ? { requestId: a.requestId } : {}) });
      });
      return { cancelAtPeriodEnd: true };
    },

    /** Cron: retry events that were received but not applied (crash, provider outage). Exponential backoff, bounded attempts. */
    async sweep() {
      if (!provider) return { due: 0, processed: 0 };
      const due = (await db.query<{ id: string }>(
        `UPDATE billing_webhook_events SET attempts = attempts + 1, next_attempt_at = now() + make_interval(mins => LEAST(60, power(2, attempts)::int))
          WHERE id IN (SELECT id FROM billing_webhook_events WHERE status IN ('received','failed') AND attempts < $1 AND next_attempt_at <= now() ORDER BY next_attempt_at LIMIT 20 FOR UPDATE SKIP LOCKED) RETURNING id`, [MAX_ATTEMPTS])).rows;
      for (const r of due) await process(r.id);
      return { due: due.length, processed: due.length };
    },

    async purge() { return (await db.query("DELETE FROM billing_webhook_events WHERE status IN ('processed','ignored') AND received_at < now() - interval '90 days'")).rowCount ?? 0; },
  };
}
export type BillingPayments = ReturnType<typeof createBillingPayments>;
