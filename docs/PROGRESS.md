# Progress

## Phase 1 — Foundation: DONE (reworked for Cloudflare Workers)
- Express 5 on Workers via `httpServerHandler` (verified in real workerd with `wrangler dev`: /health/live, /openapi.json, /docs OK)
- Strict TS, zod config, pino (browser build → console on Workers; redaction), request IDs, error envelope
- `Db` abstraction: `poolDb` (Node scripts), `hyperdriveDb` (client per query, Workers), PGlite in tests
- SQL migrator (advisory xact lock, per-file tx, checksum lock), tested on PGlite incl. real migrations
- Health: live, ready (DB), workers (heartbeats in Postgres table)
- Bundle: ~2.3 MiB / 491 KiB gzip (wrangler dry-run)

## Phase 2 — Authentication & tenancy: DONE
- Better Auth (email+password, sessions, password reset) via a Kysely dialect over our `Db` (works on Workers/Node/PGlite)
- Workspaces, members, roles (owner/admin/editor/analyst/viewer), permission map, invitations (hashed single-use tokens, Resend email), audit log
- Tenant gate `authorize()`: non-member → 404 (no existence leak), missing permission → 403; last-owner protection under row locks
- Keyset pagination helper; zod validation middleware; OpenAPI for all endpoints

## Phase 3 — Social accounts: DONE (LinkedIn OAuth + account info)
- Adapter port + capability registry (flags true only when verified); error taxonomy (`PlatformError` kinds)
- AES-256-GCM token encryption with key ring + row-bound AAD; credentials never in API output
- OAuth: single-use hashed state (10 min TTL), callback validation, reconnect, disconnect, refresh/re-authorize endpoint
- `getAccessToken()` with row-locked refresh and `needs_reauth` handling (used by the publishing engine later)
- LinkedIn adapter verified for OAuth/userinfo; publishing/analytics flags remain false until Phase 6

## Phase 4 — Content management: DONE
- posts (drafts, labels, hashtags), per-account variants (caption/title/description/hashtags/metadata, variant-level media override), post_media, media_assets (table only; upload flow = Phase 7)
- Draft edit/delete/duplicate, list with status/label/text filters (LIKE wildcards escaped) + keyset pagination
- Composite tenant FKs (`(id, workspace_id)`): foreign accounts/media cannot be referenced
- Validation endpoint `POST .../posts/:id/validate`: per-platform rules (integrations/<p>/<p>.rules.ts). Each rule is `error` only when confirmed by official docs;
  unconfirmed limits are `warning`s (LinkedIn text length, IG image formats/carousel/video specs, YT tags, X media sizes). Reports `publishable` + `publishBlockers`
  (account state, adapter not configured, capability not enabled) separately from content validity.

## Phase 5 — Publishing engine: DONE
- Jobs per variant; state machine (pending/scheduled/processing/published/failed/cancelled); transactional outbox → Cloudflare Queue; atomic claim with lease + fenced finishers
- DB-enforced duplicate guard (partial unique index: one live job per variant); `Idempotency-Key` replay; publish never re-creates jobs for failed variants (use retry)
- Retry policy (pure, tested): exponential backoff+jitter (30s..1h), Retry-After honoured, permanent/auth failures final, exhaustion → dead-lettered; manual retry keeps attempt history
- Unknown outcomes (timeouts, 5xx on the creating call, crashes/expired leases) → reconciliation via adapter lookup; else `unconfirmed` failure with duplicate warning on retry. Never auto-retried.
- Sweeper (cron): lease expiry, orphan healing (lost queue messages), outbox dispatch, reconciliation; each step isolated. Queue outage never fails the API call.
- Verified by tests with a scripted fake platform (test double only) + mutation check of the claim guard. No real platform publishing exists yet (all capability flags false).

## Phase 6 — Platform integrations: DONE (code + mocked-API tests; NOT run against live platforms)
- LinkedIn (text/image/multi-image/video), X (text/image/gif/video via chunked upload), YouTube (resumable video upload with interruption recovery + reconciliation), Instagram (image/Reel/image carousel, public-URL containers)
- Every API shape taken from official docs fetched during this phase (see docs/integrations.md); corrected two stale beliefs: YouTube quota (videos.insert own bucket 100/day) and unverified-project private-video restriction (no longer stated in docs)
- Rules updated with documented limits; unconfirmed ones remain warnings
- Blocked by external gates: LinkedIn org posting/analytics (Community Mgmt API), X paid API tier, Meta App Review, YouTube production OAuth consent

## Phase 7 — Scheduling, calendar, media, bulk: DONE
- scheduled_posts (one per post) + `scheduled` jobs released by the outbox at fire time (Postgres is the clock; queue loss cannot lose a schedule)
- Timezone-aware: absolute instant or DST-aware wall-clock + IANA zone (gap rejected, overlap -> earlier + warning); 1 min..1 year window
- Conflict detection (same account within 5 min), reschedule (drops old outbox event), cancel (post becomes editable draft), missed-job policy (>6h overdue is NOT published silently; user can retry)
- Calendar API (month / weekOf / range<=62 days, grouped by local day, filters, unscheduled drafts)
- Media: SigV4 presigned R2 URLs (verified against the AWS test vector), upload -> confirm (size + magic-byte MIME sniff + image dimensions), library with usage counts, per-platform compatibility endpoint, abandoned-upload cleanup, in-use protection
- Bulk create/schedule/cancel/status with per-item results (each item independent)
- Still NOT implemented / blocked: LinkedIn analytics (partner approval), Instagram account insights time series + demographics, video transcoding/compression (needs Cloudflare Stream or Media Transformations), video in Instagram carousels, Shorts-specific handling, YouTube `publishAt`, X threads/polls, LinkedIn org posting (approval).

## Phase 8 — Analytics engine: DONE (mocked-API tests; not run against live platform metrics)
- Collection: separate Cloudflare Queue + cron seeding (`analytics_targets`: one per account, one per published post on platforms with analytics). Cadence by post age (1h/6h/24h/7d, stop at 90d), accounts daily. Claim lease prevents concurrent collection. Failures only touch the target (rate limit wait, backoff, disable after 5 permanent): publishing is untouched (tested byte-for-byte).
- Storage: raw `analytics_snapshots` + normalized `analytics_metrics` (platform, account, post, canonical key, ORIGINAL name, definition, value NULL + availability, period, collected_at, components). Both append-only (DB trigger rejects UPDATE).
- Zero vs unavailable vs unsupported vs not-yet-collected: value 0 + available | value NULL + unavailable | no adapter capability -> `unsupported` | no snapshot yet -> `not_yet_collected`.
- Normalization layer (pure, tested): X public_metrics, YouTube statistics, Instagram media insights/followers_count; unit conversion; `interactions` derived only from components the platform reported.
- Aggregates (rebuildable): per target/metric/day|week|month last value + change since previous bucket (NULL, not 0, when nothing to compare).
- Cross-platform totals ONLY for metrics flagged comparable (likes, comments, followers, interactions) and always with per-platform values + caveat; views/impressions/reach/shares/... are never summed across platforms; ranking across platforms refuses non-comparable metrics.
- API: overview, platform, account, post, trends (day/week/month), followers growth, platform comparison, range comparison, top posts, metric definitions. Responses cached (KV or memory) with a per-workspace data-version key, so new data invalidates automatically.
- Verified from official docs: X public_metrics fields; YouTube videos/channels statistics; Instagram media insights metrics + `instagram_business_manage_insights` (Instagram scopes now include it: existing connections must re-authorize).
- Not implemented / blocked: LinkedIn analytics (partner approval), X non-public metrics (user-context auth), YouTube Analytics API (watch time/audience), Instagram account insights time series and demographics, per-day platform-reported series (`period=day`) -- we derive deltas from lifetime counters instead.

## Phase 9 — Campaigns, insights, approvals, notifications, reports: DONE
- Campaigns: CRUD, posts (at most one campaign each; moves are reported), publishing status per platform, performance (platform contribution, comparable totals only, interactions trend), campaign comparison
- Insights (deterministic, no LLM): best platform (median interactions/post), format performance within a platform, engagement change vs previous 7 days, posting consistency, follower trend, best posting slot. Each carries its evidence; rules REFUSE (listed under `skipped` with the reason) below sample thresholds (5 posts/platform, 20 posts for timing). Recommendations derive only from insights that cleared their thresholds and include a caveat. `InsightProvider` seam for future AI providers.
- Approvals (Writer -> Reviewer -> Publisher): optional per-workspace policy, N approvals, no self-approval, one vote per reviewer, content fingerprint (edits make an approval stale/outdated), gate inside the publish/schedule transaction
- Notifications: in-app + email (Resend, async via outbox with backoff, gives up after 5), per-type preferences, producers read domain events with a cursor so they can never block or roll back publishing; reauth/expiring-connection alerts; HTML-escaped emails
- Reports: asynchronous CSV exports (post / account / campaign / platform comparison / historical), RFC 4180 + formula-injection guard, empty cell = unavailable, 7-day retention, `reports:export` permission. PDF not implemented (planned).
- Webhook notifications: NOT implemented (channel seam only).

## Phase 10 — Hardening and deployment: DONE (code, tests, docs). NOT deployed.
- Security: Postgres-backed rate limiter on abuse-prone endpoints (fails open on DB outage) + Better Auth database rate limits (sign-in 5/min, sign-up 10/h, ...); Origin guard against cross-site state changes; `Cache-Control: no-store` on API responses; body-parser errors map to 413/400 (found by the sweep); media endpoints authorize before revealing configuration (found by the sweep).
- Automated guard rails (they fail the build): authorization sweep of EVERY documented endpoint as anonymous / stranger / read-only member; SQL-safety scan (only constant column lists may be interpolated into SQL); log redaction test; hard-coded-secret scan; N+1 guard on list endpoints; index audit that replays the application's real statements through EXPLAIN (found a missing index and a wasteful per-minute UPDATE; negative control verified).
- Failure tests: DB outage (clean 500s, no internals, auto-recovery), sweeps survive outages and catch up, publish is atomic under mid-transaction failure, analytics failures cannot affect publishing.
- Ops: `/health/queues` (backlog, expired leases, reconciling, dead letters; Bearer OPS_TOKEN), worker heartbeats, DLQ consumers, hourly housekeeping (idempotency keys, rate-limit rows, OAuth states, delivered outbox, exports, abandoned uploads).
- Deployment: `docs/deployment.md` (Cloudflare Workers + Neon + Queues + R2 + KV), GitHub Actions CI + manual deploy workflow. Docker/Compose/VPS deliverables from the original brief were intentionally replaced by Cloudflare hosting (user decision).

## Phase 11 — Features previously listed as "not built": DONE (mocked-API tests; not run live)
- Recurring posts (daily/weekly/monthly, DST-aware, count/until required, copy-of-template semantics, pause/resume/end, missed/approval handling, crash recovery)
- Outbound webhooks (HMAC-signed, retries, auto-disable, SSRF guard, secret shown once) and inbound Instagram webhooks (verification, signature check, dedupe) incl. deauthorize + data-deletion callbacks
- PDF reports (dependency-free PDF writer, paginated, structurally verified)
- Competitor intelligence (X, YouTube; public data only; snapshots, comparison on public metrics only)
- AI content adaptation behind a provider port (Anthropic implementation; deterministic fallback; sanitized + rule-validated; never auto-published; daily cap)
- Media: MP4/QuickTime duration + dimensions (ranged reads), image derivatives (format conversion/resize via Cloudflare Images transformations)
- YouTube: custom thumbnails (failure never affects the publication), YouTube Analytics API metrics (watch time, average view duration/percentage, shares, subscribers gained); X: non-public metrics (link/profile clicks)
- Instagram token keep-alive, token re-encryption after key rotation, `npm run test:live` (opt-in real-API smoke tests, skip without credentials)
- Fixes found while building: SQL parameter-type bugs masked by swallowed errors (now logged), timestamp handling assumptions, unauthenticated-tenant leak in a status endpoint (caught by the authorization sweep), double Content-Type on signed PUT, width/height not forwarded to the image transformer.

## Phase 12 — More platforms: DONE (code + mocked-fetch tests; NOT run against live platforms)
- Threads, Facebook Pages, Pinterest, TikTok (OAuth) and Bluesky, Mastodon, Telegram (credentials mode). Per-platform capabilities, limits and gates: docs/integrations.md.
- Port: `SocialAdapter.credentials`, `listAccounts` (Facebook: one account per Page), `NO_OAUTH`; shared `integrations/core/http.ts` (`apiFetch`, `metaFetch`); new `POST /workspaces/{ws}/accounts/connect-credentials`; `GET /platforms` now returns `connect` + `fields`; OAuth callback returns an array when it connected several accounts. Migration `0021_more_platforms.sql`.
- Env: THREADS_APP_ID/SECRET, FACEBOOK_APP_ID/SECRET, PINTEREST_APP_ID/SECRET, TIKTOK_CLIENT_KEY/SECRET, optional BLUESKY_SERVICE.
- Tests: `test/integrations/more-platforms.test.ts` (32, mocked fetch), `test/credential-accounts.test.ts` (5).
- **TikTok is UNVERIFIED**: first-party docs were not fetchable (JS-rendered); endpoint URLs from search titles, field shapes from third-party guides. Check + `npm run test:live` before use. Unaudited TikTok apps post private only.
- Gates: Meta App Review (Threads non-testers, Facebook), Pinterest Trial access (self-visible pins), TikTok audit + verified media domain.
- Not built: Reddit (commercial API approval), Snapchat (no organic posting API), WhatsApp/Discord (messaging, not social posting), Tumblr (optional later); video transcoding, Bluesky/Pinterest video, Telegram albums, Facebook/TikTok/Pinterest-pin analytics. Competitors remain X/YouTube only.

## Test results
See `npm test` for the current count (294 passed / 34 files before Phase 12 added 37 tests). Typecheck clean. Opt-in live tests: `npm run test:live` (12 skipped without credentials).
Not verified: real workerd + Neon/Hyperdrive end-to-end; real Cloudflare Queues/R2/KV/Images; any live platform API.

## Known limitations (read before launch)
- **Nothing has run against live services**: no real Neon/Hyperdrive, Cloudflare Queues/R2/KV, deployed Worker, or platform API. All platform behaviour is verified against official docs + mocked responses. Sandbox accounts and the checklist in docs/deployment.md come first.
- **Workers Paid plan required** (Free = 10 ms CPU). Worker startup time (<1 s limit) is unmeasured.
- **External approval gates**: Meta App Review (Instagram publish/insights), LinkedIn Community Management API (org posting, analytics), X paid API tier, Google production OAuth consent. LinkedIn and unconfirmed-outcome cases cannot be auto-reconciled.
- Instagram connections made before analytics existed must re-authorize (new `instagram_business_manage_insights` scope); Instagram tokens expire if unused for 60 days (a keep-alive refresh job is not implemented).
- Not implemented: recurring posts (column reserved), webhook notifications and platform webhook ingestion (`webhook_events`), PDF reports, competitor intelligence, AI content adaptation provider, image/video processing (resize/transcode; video duration/dimension extraction), YouTube Analytics API / thumbnails / Shorts handling, X non-public metrics, token re-encryption job after key rotation, `npm run test:live`.
- Index audit proves an index path exists, not selectivity at scale: load test on Neon with realistic volumes.
- Cache: KV (when bound) is eventually consistent; entries are keyed by data version so staleness is bounded by the 5-minute TTL.

## Next
1. Deploy to a sandbox Cloudflare account + Neon branch and walk the checklist in docs/deployment.md.
2. Create platform apps (start with LinkedIn), connect a test account, publish for real, fix whatever differs from the docs.
3. Load test; decide on webhook/recurring/PDF features based on real usage.
