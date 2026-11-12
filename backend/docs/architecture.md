# Architecture

Modular monolith on Cloudflare Workers. One Worker, three entry points (`fetch` Express app, `queue` consumers, `scheduled` cron), Postgres (Neon) as the single source of truth.

```
                    ┌────────────── Cloudflare Worker (src/entrypoints/worker.ts) ──────────────┐
 HTTP ───────────►  │ Express app (src/app.ts)  ── modules/* (controller→service→repository)    │
 Queues ─────────►  │ queue(): publish-jobs, analytics-collect, *-dlq                           │ ──► Neon (raw pg via Hyperdrive)
 Cron (1/min) ───►  │ scheduled(): publishing sweep ∥ analytics ∥ notifications ∥ reports       │ ──► R2 (presigned URLs)
                    └─────────────────────────── composition.ts wires everything ───────────────┘ ──► platform APIs (integrations/*)
```

## Boundaries (enforced by structure and tests)
* **modules/** — business logic. Services are the only cross-module surface; repositories (raw, parameterized SQL) are private to their module. `shared/` and `infrastructure/` hold cross-cutting code.
* **integrations/** — the only place that talks to platform APIs. The publishing, analytics and accounts modules depend on the `SocialAdapter` port + registry, never on a platform. A platform is registered in `composition.ts` only when its credentials exist (credentials-mode platforms Bluesky/Mastodon/Telegram are always registered; the user supplies per-account credentials via `connect-credentials`). Shared HTTP helpers live in `integrations/core/http.ts`. Capability flags are true only for implemented **and** documentation-verified features.
* **workers/** — queue consumers and sweepers (`publishing/`, `analytics/`); no HTTP concerns.
* **composition.ts** — the single place concrete implementations are chosen; tests use the same wiring with PGlite, in-memory queue/storage and scripted fake platforms.
* Tenant isolation: every tenant table has `workspace_id`; composite FKs `(id, workspace_id)` stop cross-tenant references; repositories require the workspace id; the `authorize()` gate answers 404 for non-members. `test/security.test.ts` sweeps **every documented endpoint** as an anonymous caller, a stranger and a read-only member, so a new route that forgets authorization fails the build.

## Publishing lifecycle (`modules/publishing`, `workers/publishing`)
1. `POST …/publish|schedule`: one transaction validates (platform rules, account state, approval gate), creates one `publishing_jobs` row **per destination** (unique live job per variant is a DB constraint), writes an `outbox_events` row (available now, or at the scheduled time), and returns 202. Idempotency-Key replays return the original result.
2. The outbox relay (immediately after commit, and every minute from cron) moves due rows to the Queue. A Queue outage never fails the request; the rows wait.
3. The consumer **claims** the job atomically (`pending|scheduled → processing`, lease token + expiry), records an attempt, calls the adapter with no DB transaction open, then finishes with lease-fenced updates.
4. Failures are classified (`retryable`, `rate_limited`, `auth_expired`, `permanent`, `unknown`): backoff with jitter/Retry-After, final failures, or **reconciliation** for unknown outcomes (timeouts, 5xx on the creating call, expired leases): the platform is asked whether the post exists; if it cannot be confirmed the job fails as `unconfirmed` and is never auto-retried (manual retry warns about a possible duplicate).
5. Sweeper (cron): expires leases, applies the missed-schedule policy (>6 h late is not published silently), heals jobs whose queue message was lost, dispatches the outbox, reconciles. Each step is isolated.
State machine: `pending|scheduled → processing → published | failed | pending(retry)`, `failed → pending` (manual), cancel only from `pending|scheduled`. Every transition is logged in `publishing_events`; every try in `publishing_attempts`.

## Analytics lifecycle (`modules/analytics`, `workers/analytics`)
Cron seeds `analytics_targets` (account + each published post on platforms with analytics) → queues due targets on a **separate queue** → a collector claims the target, calls `fetchPostMetrics/fetchAccountMetrics`, stores the raw response in `analytics_snapshots` and normalized rows in `analytics_metrics` (both append-only by DB trigger), rebuilds day/week/month `analytics_aggregates` for that target and bumps the workspace's data version. Read APIs sum only within one platform; cross-platform totals exist only for metrics flagged `comparable` and always list per-platform values + a caveat. Unavailable ≠ zero ≠ unsupported ≠ not yet collected. Analytics shares no code path or queue with publishing; its failures only affect its own rows.

## Other modules
Content (drafts, per-platform variants, validation), Media (presigned R2 upload → size/magic-byte verification), Scheduling/Calendar/Bulk, Campaigns, Insights (rule-based, evidence + refusal thresholds), Approvals (content-fingerprint gated), Notifications (cursor-based producers, outbox email), Reports (async CSV), Audit. Details and limits: `docs/PROGRESS.md`, `docs/integrations.md`, OpenAPI at `/docs`.

## Additional subsystems
* **Outbound webhooks** (`modules/webhooks`): notification events are emitted once per event into per-endpoint pending deliveries (idempotent per endpoint+event), delivered by the cron sweep with HMAC signatures, exponential backoff over ~2 days, redirects not followed, SSRF-checked URLs, auto-disable on 410 or repeated failure.
* **Inbound webhooks** (`webhooks/inbound.ts`): raw body captured for signature verification; nothing unsigned is stored; deduplicated by payload hash.
* **Recurring posts** (`modules/recurring`): a series materializes occurrence rows 24 h ahead (primary key per occurrence ⇒ idempotent), then each is processed by copying the template as it is *then* and scheduling the copy through the normal scheduling/approval/validation path.
* **Competitors** (`modules/competitors`): separate tables and collector; public data only.
* **AI** (`modules/ai`, `infrastructure/ai`): provider port; deterministic fallback; output parsed, sanitized and validated against platform rules; never persisted or published without a human step; per-workspace daily cap.
* **Token maintenance**: keep-alive refresh for long-lived tokens and re-encryption after key rotation, both idempotent cron jobs.

## Key decisions
| Decision | Why |
|---|---|
| Workers + Queues instead of Redis/BullMQ | requirement to host fully on Cloudflare; the outbox/lease design makes the queue replaceable delivery |
| Postgres lease/outbox instead of Durable Objects | no new state store; atomic claims are one SQL statement; testable in-process |
| Client-per-query `pg` through Hyperdrive | Workers cannot share connections across requests |
| Better Auth over our own Kysely dialect | same SQL path on Workers, Node and PGlite |
| PGlite for tests | real Postgres semantics without Docker; keeps the machine light |
| No ORM | requirement; all SQL is parameterized and guarded by a test |
