import { createHmac, timingSafeEqual } from "node:crypto";
import { ProviderError, WebhookSignatureError, type PaymentProvider, type ProviderEvent, type ProviderSubscription, type ProviderSubStatus } from "./types.js";

// Verified against Dodo Payments docs (2026-11): base https://test.dodopayments.com | https://live.dodopayments.com, Bearer API key;
// POST /checkouts {product_cart:[{product_id,quantity}], customer:{email}, return_url, metadata} -> {session_id, checkout_url};
// GET/PATCH /subscriptions/{id} (PATCH {cancel_at_next_billing_date:true}); webhooks follow Standard Webhooks:
// headers webhook-id / webhook-timestamp / webhook-signature ("v1,<b64>" space separated), signed "{id}.{timestamp}.{body}", key = base64 of secret after "whsec_".
const STATUS: Record<string, ProviderSubStatus> = { pending: "pending", active: "active", past_due: "past_due", on_hold: "on_hold", paused: "on_hold", cancelled: "canceled", failed: "canceled", expired: "expired" };
const TOLERANCE_S = 300;

export function createDodoProvider(o: { apiKey: string; webhookKey: string; mode?: "test" | "live"; fetch?: typeof fetch; now?: () => number }): PaymentProvider {
  const base = o.mode === "live" ? "https://live.dodopayments.com" : "https://test.dodopayments.com";
  const f = o.fetch ?? fetch;
  const now = o.now ?? (() => Date.now());
  const key = Buffer.from(o.webhookKey.replace(/^whsec_/, ""), "base64");

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try { res = await f(`${base}${path}`, { method, headers: { authorization: `Bearer ${o.apiKey}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
    catch { throw new ProviderError(502, "Payment provider unreachable"); }
    if (!res.ok) throw new ProviderError(res.status >= 500 ? 502 : res.status === 404 ? 404 : 400, `Payment provider rejected the request (${res.status})`);
    return (res.status === 204 ? {} : await res.json()) as T;
  }

  return {
    name: "dodo",
    async createCheckout(i) {
      const r = await call<{ session_id?: string; checkout_url?: string | null }>("POST", "/checkouts", { product_cart: [{ product_id: i.productId, quantity: 1 }], customer: { email: i.email }, return_url: i.returnUrl, metadata: i.metadata });
      if (!r.session_id || !r.checkout_url) throw new ProviderError(502, "Payment provider returned no checkout URL");
      return { sessionId: r.session_id, url: r.checkout_url };
    },
    async getSubscription(id) {
      const r = await call<Record<string, unknown>>("GET", `/subscriptions/${encodeURIComponent(id)}`);
      const meta = Object.fromEntries(Object.entries((r.metadata ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v)]));
      return {
        id: String(r.subscription_id ?? id), status: STATUS[String(r.status)] ?? "unknown", productId: String(r.product_id ?? ""), currency: String(r.currency ?? ""),
        customerId: (r.customer as { customer_id?: string } | undefined)?.customer_id ?? null, currentPeriodEnd: typeof r.next_billing_date === "string" ? r.next_billing_date : null,
        cancelAtPeriodEnd: r.cancel_at_next_billing_date === true, metadata: meta,
      } satisfies ProviderSubscription;
    },
    async createPortalSession(customerId, returnUrl) {
      const r = await call<{ link?: string }>("POST", `/customers/${encodeURIComponent(customerId)}/customer-portal/session?return_url=${encodeURIComponent(returnUrl)}&send_email=false`);
      if (!r.link) throw new ProviderError(502, "Payment provider returned no portal link");
      return { url: r.link };
    },
    async cancelAtPeriodEnd(id) { await call("PATCH", `/subscriptions/${encodeURIComponent(id)}`, { cancel_at_next_billing_date: true }); },

    verifyWebhook(headers, raw): ProviderEvent {
      const id = headers["webhook-id"], ts = headers["webhook-timestamp"], sig = headers["webhook-signature"];
      if (!id || !ts || !sig || !/^\d+$/.test(ts)) throw new WebhookSignatureError("missing headers");
      if (Math.abs(now() / 1000 - Number(ts)) > TOLERANCE_S) throw new WebhookSignatureError("stale timestamp");
      const expected = createHmac("sha256", key).update(`${id}.${ts}.`).update(raw).digest();
      const ok = sig.split(" ").some((part) => {
        const [v, b64] = part.split(",", 2);
        if (v !== "v1" || !b64) return false;
        const got = Buffer.from(b64, "base64");
        return got.length === expected.length && timingSafeEqual(got, expected);
      });
      if (!ok) throw new WebhookSignatureError("bad signature");
      let body: { type?: string; data?: Record<string, unknown> };
      try { body = JSON.parse(raw.toString("utf8")); } catch { throw new WebhookSignatureError("bad json"); }
      const d = body.data ?? {};
      const type = String(body.type ?? "");
      const isPayment = type.startsWith("payment.");
      const amount = typeof d.total_amount === "number" && Number.isInteger(d.total_amount) && d.total_amount >= 0 ? d.total_amount : null;
      return {
        id, type,
        subscriptionId: typeof d.subscription_id === "string" ? d.subscription_id : null,
        payment: isPayment && typeof d.payment_id === "string" && (type === "payment.succeeded" || type === "payment.failed")
          ? { id: d.payment_id, status: type === "payment.succeeded" ? "succeeded" : "failed", amountMinor: amount, currency: typeof d.currency === "string" ? d.currency : null } : null,
      };
    },
  };
}
