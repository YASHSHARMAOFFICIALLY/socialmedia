# Database schema

Raw SQL migrations in `src/infrastructure/database/migrations` (applied in order, checksum-locked, each in a transaction).

| Area | Tables |
|---|---|
| Auth (Better Auth) | `user`, `session`, `account`, `verification`, `rateLimit` |
| Tenancy | `workspaces`, `workspace_members` (role enum), `workspace_invitations` (hashed single-use tokens), `audit_logs` |
| Social accounts | `social_accounts`, `oauth_credentials` (AES-256-GCM ciphertext), `platform_permissions`, `oauth_states` (hashed, single-use) |
| Content | `posts`, `post_variants` (one per destination), `post_media`, `media_assets` |
| Publishing | `publishing_jobs`, `publishing_attempts` (append-only history), `publishing_events` (state transitions), `scheduled_posts`, `outbox_events`, `idempotency_keys` |
| Analytics | `metric_definitions`, `analytics_targets`, `analytics_snapshots` + `analytics_metrics` (append-only, trigger-enforced), `analytics_aggregates` (rebuildable), `analytics_versions` |
| Teams | `approval_policies`, `approval_requests`, `approvals` |
| Campaigns | `campaigns`, `campaign_posts` |
| Notifications | `notifications`, `notification_preferences`, `notification_cursors` |
| Recurring | `recurring_series`, `series_occurrences` |
| Webhooks | `webhook_endpoints`, `webhook_deliveries` (outbound); `webhook_events` (inbound, signature-verified) |
| Competitors | `competitors`, `competitor_snapshots`, `competitor_posts` (public data, separate from core analytics) |
| AI | `ai_usage` |
| Reports / ops | `export_jobs`, `rate_limits`, `worker_heartbeats`, `schema_migrations` |

## Relationships (simplified)
```
user ─< workspace_members >─ workspaces ─< social_accounts ─1:1─ oauth_credentials
workspaces ─< posts ─< post_variants >─ social_accounts
posts ─< post_media >─ media_assets
post_variants ─< publishing_jobs (≤1 live per variant) ─< publishing_attempts / publishing_events
posts ─1:0..1─ scheduled_posts            publishing_jobs ─ outbox_events (by aggregate_id)
social_accounts ─< analytics_targets ─< analytics_snapshots ─< analytics_metrics ;  analytics_targets ─< analytics_aggregates
posts ─ campaign_posts >─ campaigns        posts ─< approval_requests ─< approvals
```

## Integrity rules worth knowing
* Tenant-safe foreign keys: children reference `(parent_id, workspace_id)`, so a row can never point at another workspace's parent.
* `publishing_jobs_one_live_per_variant`: partial unique index — the database itself prevents duplicate live publications.
* `analytics_metrics`: `CHECK (availability = 'available') = (value IS NOT NULL)` — a missing value can never be stored as 0; UPDATE is rejected by trigger.
* Credentials, invitation tokens and OAuth state are stored only as ciphertext/hashes.
* Indexes follow the actual queries; `test/reliability.test.ts` replays the application's real statements through `EXPLAIN` with sequential scans disabled and fails if any growing table would need a full scan (it proves an index path exists; it does not prove selectivity at production data volumes → load test on Neon before launch).

## Billing and MCP (migrations 0022-0024)
- `billing_plans` / `billing_plan_versions` / `billing_prices` / `billing_entitlements`: immutable catalog (prices in integer minor units, `provider_refs` mutable). Seeded Free/Starter/Pro/Agency with PLACEHOLDER values.
- `billing_subscriptions`: unique live row per workspace; unique `(provider, provider_subscription_id)`.
- `billing_usage_events`: immutable, unique `(workspace_id, idempotency_key)`.
- `billing_webhook_events`: unique `(provider, event_id)`; `billing_payments`: unique `(provider, provider_payment_id, status)`.
- `mcp_grants` (+ `mcp_access_tokens`, `mcp_device_codes`): hashed credentials only (SHA-256); access tokens cascade-delete with their grant.
See docs/billing.md and docs/mcp.md.
