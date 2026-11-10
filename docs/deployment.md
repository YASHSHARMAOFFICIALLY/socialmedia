# Deployment (Cloudflare Workers + Neon Postgres)

> Status: **never deployed**. Everything below follows Cloudflare/Neon documentation but has not been run against a live account.
> First deploy checklist at the bottom lists what to verify.

## Components
| Concern | Service | Notes |
|---|---|---|
| API + cron + queue consumers | Cloudflare Worker (`nodejs_compat`, Express) | one Worker, three entry points: `fetch`, `queue`, `scheduled` |
| Database | Neon Postgres via Hyperdrive | raw `pg`; migrations run from CI with a **direct** connection |
| Jobs | Cloudflare Queues `publish-jobs`, `analytics-collect` (+ `-dlq`) | delivery only; Postgres is the source of truth |
| Media | R2 bucket (S3 API, presigned URLs) | clients upload/download directly; the API never proxies bytes |
| Cache | Workers KV `CACHE` (optional) | dashboard cache; falls back to per-isolate memory |
| Email | Resend | optional |

## Cost and plan requirements (read this first)
* **Workers Free is not enough.** The Free plan allows 10 ms CPU per invocation; password hashing (scrypt) and a cold start of the bundle exceed that. Use **Workers Paid ($5/month)**: 30 s CPU default per invocation, Queues included.
* Neon Free is fine to start (it scales to zero; cold starts add ~0.5–1 s to the first query after idle). R2 and Resend have free tiers. Platform API costs (X paid tier) are separate.
* Bundle: ~4 MiB / ~830 KiB gzip (`npm run build`) — within the Paid limits; Worker **startup time must stay < 1 s**: verify on first deploy (`wrangler deploy` reports it) and lazy-load heavy modules if it does not.

## One-time setup
```bash
# 1. Database
#    Create a Neon project; copy the DIRECT connection string (not the pooled one) as DATABASE_URL.
export DATABASE_URL='postgres://…neon.tech/neondb?sslmode=require'
npm run migrate                                   # applies src/infrastructure/database/migrations/*.sql in order

# 2. Hyperdrive (connection pooling for Workers)
npx wrangler hyperdrive create social-db --connection-string="$DATABASE_URL"
#    → put the printed id into wrangler.jsonc  hyperdrive[0].id

# 3. Queues
npx wrangler queues create publish-jobs && npx wrangler queues create publish-jobs-dlq
npx wrangler queues create analytics-collect && npx wrangler queues create analytics-collect-dlq

# 4. R2 + KV
npx wrangler r2 bucket create social-media-assets            # then create an R2 API token (Object Read & Write) → R2_* secrets
npx wrangler kv namespace create CACHE                       # add to wrangler.jsonc: "kv_namespaces": [{ "binding": "CACHE", "id": "…" }]
#    R2 CORS (browser uploads with presigned PUT): allow your app origin, methods PUT/GET/HEAD, header Content-Type.

# 5. Secrets (never in wrangler.jsonc)
for s in BETTER_AUTH_SECRET TOKEN_ENC_KEYS RESEND_API_KEY OPS_TOKEN R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET \
         LINKEDIN_CLIENT_ID LINKEDIN_CLIENT_SECRET X_CLIENT_ID X_CLIENT_SECRET GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET INSTAGRAM_APP_ID INSTAGRAM_APP_SECRET \
         THREADS_APP_ID THREADS_APP_SECRET FACEBOOK_APP_ID FACEBOOK_APP_SECRET PINTEREST_APP_ID PINTEREST_APP_SECRET TIKTOK_CLIENT_KEY TIKTOK_CLIENT_SECRET; do
  npx wrangler secret put "$s"; done
#    Plain vars (wrangler.jsonc "vars"): BETTER_AUTH_URL, APP_URL, CORS_ORIGINS, LOG_LEVEL.

# 6. Deploy
npm run deploy
```
Then register the OAuth redirect URI `https://<api-host>/oauth/<platform>/callback` in each OAuth platform app (linkedin, x, youtube, instagram, threads, facebook, pinterest, tiktok). Bluesky, Mastodon and Telegram connect with user-supplied credentials (`POST …/accounts/connect-credentials`): no app, no redirect URI; `BLUESKY_SERVICE` (optional) overrides the default PDS host. TikTok additionally needs the media domain verified in its portal (R2 custom domain). Request the platform approvals listed in `docs/integrations.md` (several are external gates: Meta App Review, LinkedIn Community Management API, X paid tier).

## Edge protection (Cloudflare dashboard, no code)
* **WAF rate limiting** rule: e.g. 300 requests/minute per IP for the API host, stricter (10/min) for `/api/auth/*`. The app's own Postgres limiter and Better Auth limits are the second line, not the first.
* Turn on **Bot Fight Mode**, enforce HTTPS (HSTS is also sent by the app).

## Environment variables
See `.env.example` for every variable. Required for a working deployment: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `TOKEN_ENC_KEYS`, `CORS_ORIGINS`, `APP_URL`, plus at least one platform's credentials. Key rotation: prepend a new key (`2:<new>,1:<old>`), deploy, later drop the old one after re-encryption has been verified (re-encryption job is not implemented: old keys must stay until all tokens are refreshed/re-linked).

## Operations
* **Health**: `GET /health/live`, `/health/ready` (DB), `/health/workers` (last heartbeat of publishing/scheduling/analytics, stored in Postgres), `/health/queues` (Bearer `OPS_TOKEN`; backlog, expired leases, reconciling jobs, dead letters, analytics backlog; 503 when degraded). Point an uptime monitor at `/health/ready` and `/health/queues`.
* **Logs**: Workers Logs (observability enabled) — structured JSON, secrets redacted. Alert on messages `dead-lettered queue message`, `sweep failed`, `publish attempt failed`.
* **Cron** runs every minute: publishing recovery (outbox relay, lease expiry, orphan healing, reconciliation, missed-schedule policy), analytics seeding/queueing, notification delivery, report generation. Hourly: abandoned-upload and expired-export cleanup.
* **Recovery model**: Postgres is the only state that matters. Losing queues/KV loses nothing permanent: the next sweep re-creates deliveries. A crashed Worker invocation leaves an expiring lease that the sweeper turns into a reconciliation (never a blind retry).
* **Backups**: Neon point-in-time restore (retention depends on plan; set it ≥ 7 days) and branch snapshots before risky migrations. R2: enable object versioning/lifecycle as desired; media can be re-uploaded, tokens cannot be recovered without the DB → treat `TOKEN_ENC_KEYS` as backup-critical (store in a password manager; losing it means all accounts must be reconnected).
* **Migrations** are forward-only SQL files with checksum locking; never edit an applied file, add a new one. Run them before deploying code that needs them (the deploy workflow does).

## Optional features: what to configure
* **Image conversion/resizing** (`POST …/media/{id}/derivatives`): enable *Images transformations* for your zone/account and allow the R2 signed-URL origin (Cloudflare Images → Transformations). Without it the endpoint answers 503 `IMAGE_TRANSFORM_UNAVAILABLE`; nothing else is affected. Video transcoding is NOT provided (would need Cloudflare Stream / Media Transformations).
* **AI suggestions**: `ANTHROPIC_API_KEY` (+ optional `AI_MODEL`, `AI_DAILY_LIMIT`). Post text is sent to the provider; leave unset to keep AI off.
* **Instagram webhooks / deauthorize / data deletion**: set the three callback URLs and verify token in the Meta app (see docs/integrations.md). Meta requires the deauthorize and data-deletion URLs for production apps.
* **Outbound webhooks** need no setup; customers register HTTPS endpoints via the API.
* After deploying a version that adds OAuth scopes (Instagram insights, YouTube Analytics), existing connections keep working for publishing; analytics that need the new scope are reported unavailable until the account is reconnected.
* Housekeeping runs from cron: token keep-alive (Instagram 60-day tokens are refreshed when ≤10 days remain), re-encryption after `TOKEN_ENC_KEYS` rotation (once a rotation finishes you can drop the old key; verify with `SELECT count(*) FROM oauth_credentials WHERE left(access_token_enc, 2) <> '2.'` replacing the id), purge of old bookkeeping rows.

## First-deploy verification checklist (not yet done)
1. `wrangler deploy` succeeds; reported startup time < 1 s.
2. `/health/ready` is 200 through Hyperdrive; sign-up/sign-in work (Better Auth over Hyperdrive in real workerd).
3. Cron fires (`/health/workers` shows scheduling heartbeat within 2 minutes).
4. Publish a text post to a sandbox LinkedIn/X account; kill the Worker mid-publish is hard to simulate — instead verify `/health/queues` stays `ok` and the job reaches `published`.
5. Presigned R2 upload from a browser (CORS) → confirm → compatibility endpoint.
6. Per new platform (Threads, Facebook, Pinterest, TikTok, Bluesky, Mastodon, Telegram): connect a sandbox/test account, publish a text post, fix whatever differs from the docs. TikTok's adapter is unverified against first-party docs: check it first. Apply migration 0021 before deploying code that connects them.
7. Free-tier smoke: confirm Queues delivery and DLQ routing from the dashboard.
