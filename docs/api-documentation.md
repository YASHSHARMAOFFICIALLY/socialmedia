# API documentation

Machine-readable: `GET /openapi.json`; interactive: `GET /docs` (Swagger UI loaded from a CDN). Every endpoint below is generated from the same Zod schemas that validate requests.

## Conventions
* **Auth**: Better Auth cookie session (`/api/auth/*`: sign-up, sign-in, sign-out, sessions, password change/reset). Passwords: min 10 characters. State-changing requests carrying an `Origin` header must come from `CORS_ORIGINS`.
* **Envelope**: success `{ "data": …, "meta"?: { "nextCursor": string|null } }`; failure `{ "error": { "code", "message", "details"?, "requestId" } }`. `x-request-id` is echoed on every response.
* **Pagination**: keyset. `?limit=` (≤100) and `?cursor=` from `meta.nextCursor`.
* **Tenancy**: workspace-scoped paths `/workspaces/{workspaceId}/…`. Non-members get 404 (never 403) so workspace existence is not revealed; members lacking a permission get 403. Roles: owner, admin, editor, analyst, viewer.
* **Idempotency**: `POST …/posts/{id}/publish` accepts `Idempotency-Key`.
* **Rate limits**: 429 `RATE_LIMITED` with `Retry-After` on abuse-prone endpoints (publish 30/min, schedule 60/min, OAuth connect 10/min, uploads 60/min, reports 10/h, bulk 20/min, invitations 20/h) and on auth endpoints (sign-in 5/min).
* **Unavailable data**: analytics fields are `null` when a platform did not provide them; they are never 0 by default.

## Endpoint groups
| Group | Highlights |
|---|---|
| Auth | register, login, logout, sessions |
| Workspaces | create/list/update, members + roles, invitations, audit log |
| Social accounts | `GET /platforms` (verified capabilities; `connect`: `"oauth"`\|`"credentials"`\|`null`; `fields` for credentials platforms), connect (returns authorization URL), `POST …/accounts/connect-credentials {platform, fields}` (Bluesky `identifier`+`appPassword`, Mastodon `instance`+`accessToken`, Telegram `botToken`+`chat`), OAuth callback (returns an array when it connected several accounts, e.g. one per Facebook Page), list/disconnect/refresh |
| Content | drafts, per-account variants, duplicate, `POST …/validate` (errors, unverified-rule warnings, publish blockers) |
| Publishing | publish now, status/history (`/publications`), cancel, retry |
| Scheduling | schedule (absolute or DST-aware local time), reschedule, cancel, calendar (month/week/range), bulk create/schedule/cancel/status |
| Media | presigned upload → confirm, library (search/filter/usage), per-platform compatibility, delete |
| Analytics | overview, platform, account, post, trends, platform & range comparison, top posts, metric definitions |
| Campaigns | CRUD, posts, performance, comparison |
| Insights | evidence-based insights, recommendations |
| Approvals | policy, submit, decide, cancel |
| Notifications | list/read, preferences |
| Reports | request CSV export, status, download |
| Recurring | `POST …/posts/{id}/recurrence` (daily/weekly/monthly, DST-aware), list, pause/resume, end |
| Webhooks (outbound) | signed event deliveries to your URLs; create/rotate secret/ping/delivery log |
| Platform webhooks (inbound) | Instagram verification, events, deauthorize, data deletion (signature-verified) |
| Competitors | track public accounts (X, YouTube), profile, comparison |
| AI (optional) | per-destination adaptation suggestions, caption/title/hashtag/rewrite alternatives (nothing is saved) |
| Reports | CSV or PDF exports |
| Health | `/health/live`, `/health/ready`, `/health/workers`, `/health/queues` (ops token) |
