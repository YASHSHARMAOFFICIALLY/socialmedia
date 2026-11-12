# Billing and entitlements

Provider-independent billing, one provider adapter so far: **Dodo Payments** (Razorpay was dropped; the `PaymentProvider` port keeps others possible). Billing is **per workspace**. Money is **integer minor units** (paise / cents) plus an ISO currency, never floats.

## Status (read first)
- Built and tested against **mocked HTTP** that follows Dodo's published API (checked against their docs and OpenAPI, 2026-11). **Never run against the Dodo sandbox.** Before charging anyone: create test products, set keys, walk the checklist at the bottom.
- Plan prices and limits seeded by migration `0022` are **placeholders**. Publish real ones with the operator endpoint (below). Existing subscribers stay on their plan version.
- Dodo payload field names for `payment.*` events (`payment_id`, `subscription_id`, `total_amount`, `currency`) come from partial docs. Subscription state never depends on them (see "Webhook pipeline"); only the payments list does, and it stores `NULL` instead of guessing.

## Concepts
| Table | Purpose |
|---|---|
| `billing_plans`, `billing_plan_versions`, `billing_prices`, `billing_entitlements` | Catalog. A version is immutable (trigger); only `provider_refs` (the provider's product id) may change. New prices = new version. |
| `billing_subscriptions` | One live (non-canceled) row per workspace (unique index). `provider_subscription_id` unique per provider. |
| `billing_usage_events` | Immutable, idempotent per `(workspace, key)`. |
| `billing_webhook_events` | Verified provider events, unique per `(provider, event_id)`, with `status` received/processed/ignored/failed. |
| `billing_payments` | Payments as reported by the provider. |

Statuses: `incomplete` (checkout started) → `active` ⇄ `past_due` (grace, keeps access) / `unpaid` (provider on hold, **no** access) → `canceled` (terminal; resubscribing creates a new row). Pure state machine in `billing.state.ts`.

## Entitlements
`billingService.check/enforce(workspaceId, feature, qty)` is the only place plan limits are read. Kinds: `flag` (0/1), `value` (a number such as history days), `count` (live resource count: `connected_accounts`, `seats`), `metered` (usage events in the current UTC calendar month: `posts_per_month`). Failing `enforce` throws HTTP 402 `PLAN_LIMIT_REACHED` with `{feature, limit, used, plan}`.
- **MCP** always requires the `mcp_access` entitlement (Free: no). Billing read tools work on any plan.
- **REST** gates (accounts connect, invitations + accept, publish/schedule) apply only when `BILLING_ENFORCE=true`. Default is off so deploying this does not suddenly cap existing workspaces. Turn it on deliberately.
- **Metering**: one `posts_per_month` unit per destination that actually **published** (inside the same transaction that marks it published, idempotent per job). Queued/failed jobs are never counted.

## Checkout and webhooks
1. `POST /workspaces/{ws}/billing/checkout {plan, currency, interval}` (owner). Creates/reuses an `incomplete` row, creates a Dodo checkout session with `metadata.billing_subscription_id`, returns `checkoutUrl`. **Nothing is granted yet.**
2. Dodo calls `POST /webhooks/dodo`. The signature (Standard Webhooks: `webhook-id`, `webhook-timestamp`, `webhook-signature`, HMAC-SHA256 over `id.timestamp.rawBody`, 5-minute tolerance, constant-time compare) is verified over the **raw body** before anything is stored. Invalid = 401, nothing stored.
3. The event is inserted (duplicate event ids are ignored), processed inline, and acknowledged with 200. If processing fails (provider down, crash), the cron sweeper retries with exponential backoff up to 8 attempts; failures stay visible in `billing_webhook_events` and the operator endpoint.
4. Processing **re-fetches the subscription from Dodo with our API key** and applies *that* state (not the webhook body). It binds to our row by `metadata.billing_subscription_id`, requires the provider product to equal the plan's mapped product, and passes the status through the state machine. Duplicate, late, out-of-order and replayed events converge to the same result; a canceled subscription is never resurrected.

Cancel: `POST /workspaces/{ws}/billing/cancel` sets cancel-at-period-end at Dodo; the local flag changes only after Dodo accepts. Portal: `POST /workspaces/{ws}/billing/portal` creates a Dodo customer-portal link on demand (Dodo links last 24h); never stored. Refunds, plan changes and payment-method edits are **not** exposed anywhere (portal only).

## Endpoints
User (cookie session, documented in `/docs`): `GET /billing/plans`, `GET /workspaces/{ws}/billing`, `GET .../billing/payments`, `POST .../billing/checkout`, `POST .../billing/cancel`, `POST .../billing/portal`. Roles: owner = read+manage, admin = read, others none.

Operator (`Authorization: Bearer $OPS_TOKEN`, 404 if unset, not in OpenAPI):
- `POST /admin/billing/plans/{plan}/versions` body `{prices:[{currency,interval,amountMinor}], entitlements:[{feature,kind,limit}]}` publishes version N+1 and retires N for new subscribers. Then map each price: `PUT /admin/billing/plans/{plan}/prices/{currency}/{interval}/provider-ref {provider:"dodo", ref:"<product id>"}`.
- `GET /admin/billing/webhook-events?status=failed`, `POST /admin/billing/webhook-events/{id}/retry`.

## Setup
1. Dodo dashboard: create one subscription product per plan/currency/interval (test mode first). Webhook endpoint `https://<api>/webhooks/dodo`; copy the signing secret.
2. `wrangler secret put DODO_API_KEY`, `DODO_WEBHOOK_KEY`; `DODO_MODE=test` until live. Set `OPS_TOKEN`.
3. Publish real prices (operator endpoint), then map product ids.
4. Sandbox checklist: checkout completes → subscription `active` + plan changes; failed renewal → `past_due` then `unpaid`; cancel → `cancelAtPeriodEnd`; replay a webhook (no change); stop the provider mid-webhook (sweeper heals); portal link opens.

## Security
Secrets (`DODO_*`, ops token) are env secrets only and are redacted from logs; provider error bodies are never stored or returned. No card data is ever received or stored: card entry happens on Dodo's hosted pages. Every billing mutation is audited (`audit_logs`).
