/** Provider-independent payment port. The billing module depends on this, never on a provider's SDK or field names. */
export type ProviderSubStatus = "pending" | "active" | "past_due" | "on_hold" | "canceled" | "expired" | "unknown";

export interface ProviderSubscription {
  id: string;
  status: ProviderSubStatus;
  productId: string;
  currency: string;
  customerId: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  metadata: Record<string, string>;
}
export interface ProviderEvent { id: string; type: string; subscriptionId: string | null; payment: { id: string; status: "succeeded" | "failed"; amountMinor: number | null; currency: string | null } | null }

export class ProviderError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }   // message never contains provider response bodies or credentials
}
export class WebhookSignatureError extends Error {}

export interface PaymentProvider {
  readonly name: string;
  createCheckout(i: { productId: string; email: string; returnUrl: string; metadata: Record<string, string> }): Promise<{ sessionId: string; url: string }>;
  getSubscription(id: string): Promise<ProviderSubscription>;
  cancelAtPeriodEnd(id: string): Promise<void>;
  /** Provider-hosted customer portal link (manage payment method, invoices, plan). Lifetime is the provider's (Dodo: 24h). */
  createPortalSession(customerId: string, returnUrl: string): Promise<{ url: string }>;
  /** Throws WebhookSignatureError unless the signature over the RAW body is valid and fresh. */
  verifyWebhook(headers: Record<string, string | undefined>, rawBody: Buffer): ProviderEvent;
}
