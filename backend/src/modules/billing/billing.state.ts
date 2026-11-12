/** Subscription lifecycle. Pure: webhook processors and services call transition(), nothing else decides status. */
export const STATUSES = ["incomplete", "trialing", "active", "past_due", "unpaid", "canceled"] as const;
export type SubStatus = (typeof STATUSES)[number];
export type SubEvent = "activated" | "payment_failed" | "suspended" | "payment_succeeded" | "canceled" | "expired";

const NEXT: Record<SubStatus, Partial<Record<SubEvent, SubStatus>>> = {
  incomplete: { activated: "active", payment_succeeded: "active", canceled: "canceled", expired: "canceled" },
  trialing:   { activated: "active", payment_succeeded: "active", payment_failed: "past_due", suspended: "unpaid", canceled: "canceled", expired: "canceled" },
  active:     { activated: "active", payment_succeeded: "active", payment_failed: "past_due", suspended: "unpaid", canceled: "canceled", expired: "canceled" },
  past_due:   { activated: "active", payment_succeeded: "active", payment_failed: "past_due", suspended: "unpaid", canceled: "canceled", expired: "canceled" },
  unpaid:     { activated: "active", payment_succeeded: "active", suspended: "unpaid", canceled: "canceled", expired: "canceled" },   // on hold: no access, recoverable
  canceled:   {},   // terminal: resubscribing creates a NEW row, so a late webhook can never resurrect a canceled subscription
};

/** Returns the next status, or null when the event is not valid in `from` (caller ignores it: duplicates and late events are normal). */
export const transition = (from: SubStatus, event: SubEvent): SubStatus | null => NEXT[from][event] ?? null;

/** Statuses that grant the plan's entitlements. past_due keeps access (grace) until the provider cancels the subscription. */
export const GRANTS_ACCESS: ReadonlySet<SubStatus> = new Set(["trialing", "active", "past_due"]);
