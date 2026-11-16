/**
 * Published list prices used for the dashboard's cost ESTIMATE. Check these against the vendors' pricing pages when they change:
 *  - Cloudflare Workers Paid: https://developers.cloudflare.com/workers/platform/pricing/
 *  - Cloudflare R2: https://developers.cloudflare.com/r2/pricing/
 *  - Neon: https://neon.com/pricing (plan assumed Free: $0; the storage cap itself is read live from neon.max_cluster_size)
 */
export const PRICES = {
  asOf: "2026-11",
  workers: { baseUsd: 5, includedRequests: 10_000_000, usdPerMillionRequests: 0.3 },   // Workers Paid (needed for Queues); Hyperdrive is included
  r2: { includedGb: 10, usdPerGbMonth: 0.015 },
  neon: { plan: "Free", storageLimitBytes: 1024 * 1024 * 1024, usdPerMonth: 0 },   // fallback only: the dashboard reads the live neon.max_cluster_size setting
} as const;

const round = (n: number) => Math.round(n * 100) / 100;

/** Monthly cost estimate from what we measure: request volume, database size and media bytes. Everything else is listed as not tracked. */
export function estimateMonthlyCosts(u: { requestsPerMonth: number; dbBytes: number; r2Bytes: number; dbLimitBytes?: number }) {
  const extraReq = Math.max(0, u.requestsPerMonth - PRICES.workers.includedRequests);
  const extraGb = Math.max(0, u.r2Bytes / 1e9 - PRICES.r2.includedGb);
  const items = [
    { key: "workers_base", label: "Workers Paid plan", usd: PRICES.workers.baseUsd, basis: "flat monthly fee" },
    { key: "workers_requests", label: "Workers requests", usd: round((extraReq / 1e6) * PRICES.workers.usdPerMillionRequests), basis: `${Math.round(u.requestsPerMonth).toLocaleString("en-US")} req/mo projected, first 10M included` },
    { key: "neon", label: `Neon (${PRICES.neon.plan})`, usd: PRICES.neon.usdPerMonth, basis: u.dbBytes > (u.dbLimitBytes ?? PRICES.neon.storageLimitBytes) ? "over the plan's storage limit: an upgrade is needed" : "within plan limits" },
    { key: "r2_storage", label: "R2 storage", usd: round(extraGb * PRICES.r2.usdPerGbMonth), basis: "media bytes we track, first 10 GB included" },
  ];
  return {
    estimate: true as const,
    currency: "USD" as const,
    pricesAsOf: PRICES.asOf,
    items,
    totalUsd: round(items.reduce((s, i) => s + i.usd, 0)),
    notTracked: ["Workers CPU time", "Queues operations", "R2 operations and egress", "Neon compute hours"],
  };
}
