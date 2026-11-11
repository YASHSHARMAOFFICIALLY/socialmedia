# Integrations

`GET /platforms` reports capability flags. A flag is TRUE only when the capability is implemented, unit-tested against mocked API responses
AND matches the platform's official documentation (fetched 2026-11). Nothing here has been exercised against a live platform account:
live smoke tests need real app credentials and are an explicit TODO (`npm run test:live`, not yet written).

The publishing engine never imports a platform module; adapters are registered in `src/composition.ts` only when their credentials are set (Bluesky, Mastodon and Telegram need none and are always registered).

## LinkedIn  (`LINKEDIN_CLIENT_ID/SECRET`)
Verified (Microsoft Learn: authorization-code flow, Posts API, Images API, Videos API, Vector Assets, little text format, MultiImage):
- OAuth 2.0 code flow; scopes `openid profile email w_member_social`; `GET /v2/userinfo`; ~60-day access tokens; refresh tokens only for approved partners (`tokenRefresh=false` → expiry means re-authorize).
- `POST /rest/posts` (`Linkedin-Version: 202610`, `X-Restli-Protocol-Version: 2.0.0`), 201 + `x-restli-id`. Text, single image, multi-image (2–20), video.
- Images: `initializeUpload` → PUT with bearer token (JPG/PNG/GIF). Video: `initializeUpload` → 4 MB parts PUT **without** token → ETags → `finalizeUpload`; MP4, 3 s–30 min, 75 KB–500 MB.
- `commentary` uses "little text format": reserved characters `| { } @ [ ] ( ) < > # \ * _ ~` are backslash-escaped; hashtags use `{hashtag|\#|tag}`.
- No idempotency key exists → a failure after the create call is an UNKNOWN outcome. Auto-reconciliation needs `r_member_social` (restricted), so LinkedIn jobs end `unconfirmed` instead (`lookupRecentPosts=false`).
- Not implemented: organization (page) posting and all analytics (need Community Management API approval = external gate), documents/articles/polls, scheduling (we schedule ourselves).
- Not in official docs: a commentary length limit (~3,000 reported by integrators) → validation WARNING only.
- API versions are sunset after ~12 months: bump `LINKEDIN_API_VERSION` regularly.

## X  (`X_CLIENT_ID/SECRET`)
Verified (docs.x.com): OAuth 2.0 + PKCE (S256), `x.com/i/oauth2/authorize`, `api.x.com/2/oauth2/token`, scopes `tweet.read tweet.write users.read media.write offline.access` (refresh tokens need `offline.access`);
chunked media upload `initialize`/`append`(≤5 MB segments)/`finalize`/`STATUS`; categories tweet_image 5 MB, tweet_gif 15 MB, tweet_video 20 min/8 GB (Premium 125 min/16 GB); a post holds up to 4 photos, 1 GIF or 1 video; `POST /2/tweets` → 201.
- 280 characters is enforced for standard accounts (URLs weigh 23); `metadata.longPost=true` lifts it for Premium accounts (the 25,000 figure is NOT in official docs → warning above it).
- API access (write volume, read for reconciliation) depends on the app's paid X API tier — EXTERNAL GATE. Reconciliation reads your timeline; without read access an unknown outcome ends `unconfirmed`.
- Rate limits: 429 with `x-rate-limit-reset` (epoch seconds) is honoured. Duplicate-content rejection (403) is permanent.
- Analytics: public_metrics always; `non_public_metrics` (link clicks, profile clicks) requested separately with the same OAuth 2.0 user token (docs: owner's posts, limited window after posting) and reported UNAVAILABLE when X refuses them.
- Competitors: `GET /2/users/by/username/{u}` + user timeline, public fields only (needs read access on your API tier).
- Not implemented: threads, polls, alt text.

## YouTube  (`GOOGLE_CLIENT_ID/SECRET`)
Verified (Google OAuth web-server, YouTube Data API videos.insert, resumable upload protocol, Quota Calculator):
- `access_type=offline` + `prompt=consent` for a refresh token; scopes `youtube.upload`, `youtube.readonly`; token endpoint `oauth2.googleapis.com/token`.
- Resumable upload: POST init (with `X-Upload-Content-*`) → `Location` session URI → PUT the file (streamed from object storage). An interrupted PUT is resolved with `Content-Range: bytes */N` (308 → resume from the next byte, or 200/201 → already complete) — an upload is never restarted blindly.
- Limits: title ≤100 chars, description ≤5000 **bytes**, no `<`/`>`; max file 256 GB.
- Quota (current docs): `videos.insert` has its OWN default bucket of **100 calls/day** (resets midnight Pacific); everything else shares 10,000 units/day. `quotaExceeded` → job waits until the reset.
- Docs state videos from unverified API projects are NOT forced private (older guidance said otherwise) — re-check when you request production access.
- Reconciliation: uploads playlist (cheap list call), matched by exact title + time.
- Custom thumbnails: `thumbnails.set` (JPEG/PNG, ~50 quota units) after the upload; a refused thumbnail NEVER fails or retries the publication (the video is already public): it is recorded as a warning on the attempt. 2 MB / verified-channel requirements are not in the pages consulted → advisory warnings.
- Analytics: Data API statistics + YouTube Analytics API (`yt-analytics.readonly`) for watch time, average view duration/percentage, shares, subscribers gained. Connections made before this scope existed must re-authorize; until then those metrics are UNAVAILABLE.
- Competitors: channels.list (`id` or `forHandle`, 1 unit) + uploads playlist + videos.list statistics (public).
- Not implemented: Shorts-specific handling (a short vertical video uploads like any video), `publishAt` native scheduling (we schedule ourselves), categories beyond `metadata.categoryId`.
- Not in official docs: tags ≤500 characters → warning.
- Google "Testing"-status OAuth apps are reported to expire refresh tokens after 7 days (not in the pages consulted) — publish the consent screen before production.

## Instagram  (`INSTAGRAM_APP_ID/SECRET` — the Instagram app id/secret, "Instagram API with Instagram Login")
Verified (Meta developer docs: Business Login for Instagram, Content Publishing):
- Authorize `instagram.com/oauth/authorize` (`instagram_business_basic`, `instagram_business_content_publish`); code → short-lived token (`api.instagram.com/oauth/access_token`) → long-lived 60-day token (`graph.instagram.com/access_token?grant_type=ig_exchange_token`); refresh via `refresh_access_token` (token ≥24 h old, unexpired). There is no refresh token: the long-lived token is stored as both credentials. A token not refreshed within 60 days dies → a daily token-maintenance job is planned (Phase 11).
- Account insights: `GET /<IG_ID>/insights?metric=reach,views,accounts_engaged,likes,comments,shares,saves,reposts,profile_links_taps&period=day&metric_type=total_value` (daily, last 24 h) stored as `period='day'` account metrics and served at `/analytics/activity` (never summed across days or accounts); audience demographics (`follower_demographics`, `engaged_audience_demographics`; `period=lifetime&metric_type=total_value&timeframe=this_month&breakdown=age|gender|city|country`) refreshed weekly into `analytics_audience` and served at `/analytics/accounts/{id}/audience`. Accounts under 100 followers (100 engagements for the engaged audience) get nothing from Meta: reported as unavailable. Shapes verified against Meta's IG User insights reference.
- Publishing: container (`/<IG_ID>/media` with `image_url`/`video_url`, `media_type=REELS` for a single video; carousel children use `is_carousel_item=true`, videos as `media_type=VIDEO`) → poll `status_code` (FINISHED/ERROR/EXPIRED) → `/<IG_ID>/media_publish`. Carousel (images only here): children with `is_carousel_item`, ≤20.
- **Meta fetches media from a public URL** → the media layer must hand out signed public GET URLs.
- JPEG is the only supported image format. Professional (Business/Creator) accounts only. Rate limit: 100 API-published posts per 24 h per the Rate Limit section (another section of the same page says 50 — use `GET /<IG_ID>/content_publishing_limit` at runtime; not yet wired).
- EXTERNAL GATES: Meta App Review for `instagram_business_content_publish` and Advanced Access.
- Webhooks: GET verification handshake and POST events with `X-Hub-Signature-256` (HMAC-SHA256 of the raw body with the app secret) — unsigned requests are rejected before anything is stored; deauthorize and data-deletion callbacks (`signed_request`) disconnect the account, delete its tokens and (deletion) its collected analytics. Configure the URLs `/webhooks/instagram`, `/webhooks/instagram/deauthorize`, `/webhooks/instagram/data-deletion` and `INSTAGRAM_WEBHOOK_VERIFY_TOKEN` in the Meta dashboard.
- Not implemented: Stories, collaborators, product tags, alt text, video in carousels, account insights time series/demographics. Competitor lookup (Business Discovery) needs Facebook Login: `competitorLookup=false`.
- Reels specs (duration, codec, size) are not confirmed → warning only.

## Connect modes (all platforms)
* **OAuth** (LinkedIn, X, YouTube, Instagram, Threads, Facebook, Pinterest, TikTok): `POST …/accounts/connect` → authorization URL → callback (the callback needs the SAME logged-in session that started the flow, otherwise a victim's authorization could be attached to an attacker's workspace). The callback may connect several accounts (Facebook: one per Page, each with its own Page token; reconnecting keeps only the matching Page); the callback JSON is an array when more than one account was connected.
* **Credentials** (Bluesky, Mastodon, Telegram; adapters expose `credentials`, `oauth = NO_OAUTH`): `POST /workspaces/{ws}/accounts/connect-credentials {platform, fields}`. Fields: bluesky `identifier` + `appPassword`; mastodon `instance` + `accessToken`; telegram `botToken` + `chat`. The adapter validates them against the platform before anything is stored.
* `GET /platforms` returns `connect` (`"oauth"` | `"credentials"` | `null` when not configured) and, for credentials platforms, `fields` (name, label, secret, help).
* Bluesky, Mastodon and Telegram are always registered (no app credentials). The OAuth ones register only when their env vars are set.

## New platforms (code + mocked-fetch tests only; NEVER run against a live account)
Shared helpers: `src/integrations/core/http.ts` (`apiFetch`, `metaFetch`). Port additions: `SocialAdapter.credentials`, `listAccounts`, `NO_OAUTH`. Migration `0021_more_platforms.sql` widens the `social_accounts.platform` CHECK.

### Threads  (`THREADS_APP_ID/SECRET`)
Verified (developers.facebook.com/docs/threads): authorize `threads.com/oauth/authorize`; code → short-lived → long-lived (60 d, `th_exchange_token`); refresh via `th_refresh_token` (valid token only).
- Text, image, video, carousel (2–20). Container (`/{user}/threads`) → `threads_publish`; media must be at a public URL.
- Text ≤500 characters, emoji counted as UTF-8 bytes. Limit 250 posts / 24 h.
- Insights: views, likes, replies, reposts, quotes, shares per post; `followers_count` per account.
- Container status values (`IN_PROGRESS|FINISHED|ERROR|EXPIRED`) are the Meta convention, NOT shown on the Threads pages read.
- GATE: non-tester users need Meta advanced access / app review.

### Facebook Pages  (`FACEBOOK_APP_ID/SECRET`, Graph API v27.0)
Verified: `GET /{user}/accounts` (Pages + Page tokens), `/{page}/feed`, `/{page}/photos`, multi-photo via `attached_media`, `/{page}/videos` (`file_url`).
- Text, photo, multi-photo, video. Scopes `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`, `read_insights`, `publish_video` (existing connections must re-authorize for `read_insights`).
- Analytics (metric names per Meta's Page/insights + deprecated-metrics pages; the response envelope is the standard Insights shape, not spelled out on the page): post `post_media_view`, `post_total_media_view_unique`, `post_clicks`, `post_reactions_by_type_total` (all reaction types summed, stored as `likes` with that definition) + `shares`/`comments` from the post edge; Page `page_follows`, `page_media_view` (day). The old impression metrics are gone (2025-06-15 / 2025-11-15) and Meta announced more Page deprecations for 2026-06-15: a removed metric makes that collection fail visibly, never a zero. Insights on video-object ids may be rejected. Unverified live.
- GATE: Meta App Review. Page-token lifetime mechanics beyond the standard `fb_exchange_token` flow are NOT verified. No hard text limit documented → none enforced.

### Pinterest  (`PINTEREST_APP_ID/SECRET`)
Verified (API v5 OpenAPI spec): token endpoint with HTTP Basic; apps activated after 2025-09-25 get a continuous 60-day refresh token.
- One image pin from a URL; requires `metadata.boardId`. title ≤100, description ≤800, link ≤2048, alt text ≤500.
- Account metric: `follower_count`. Pin analytics (UNVERIFIED shape): `IMPRESSION`, `SAVE`, `PIN_CLICK`, `OUTBOUND_CLICK` over a window capped at 90 days; `lifetime_metrics` preferred, `summary_metrics` fallback.
- Video pin (UNVERIFIED): `POST /v5/media` → multipart upload → poll `GET /v5/media/{id}` → pin with `video_id` + cover (attach an image with role `thumbnail`; required). Endpoints/fields from Pinterest's generated client docs; status values and the cover requirement from third-party/community reports. Not available in the sandbox. File is buffered in memory.
- Not implemented: reconcile.
- GATE: Trial access creates pins visible only to you until Standard access is granted.

### TikTok  (`TIKTOK_CLIENT_KEY/SECRET`) — UNVERIFIED
**SOURCE CAVEAT**: developers.tiktok.com is JavaScript-rendered and could not be fetched. Endpoint URLs (`/v2/post/publish/video/init/`, `/v2/post/publish/status/fetch/`, `PULL_FROM_URL`) were confirmed from search titles only; token endpoint and field shapes come from third-party guides. Check against first-party docs and `npm run test:live` before any use.
- Video only, via `PULL_FROM_URL`; `privacy_level` must be one of the creator's options (queried at publish time); async status polling.
- Analytics (UNVERIFIED; docs page returned 503, details from search results quoting it): `POST /v2/video/query/` (`view_count`, `like_count`, `comment_count`, `share_count`; scope `video.list`) and `GET /v2/user/info/?fields=follower_count` (scope `user.info.stats`; TikTok's own pages disagree between `.stats` and `.profile`). A post that is still processing only has a `publish_id`: its metrics stay unavailable. Scopes added, so existing connections must re-authorize.
- GATE: unaudited apps can post private only. The media URL's domain must be verified in the TikTok portal → R2 needs a custom domain.

### Bluesky  (credentials; optional `BLUESKY_SERVICE`)
Verified (atproto lexicons): app password (never the account password), `createSession`/`refreshSession`, `createRecord`, `uploadBlob`.
- Text ≤300 graphemes (≤3000 bytes), up to 4 images ≤2,000,000 bytes each; link/mention/hashtag facets with byte offsets.
- One video instead of images (flow from the official tutorial, UNVERIFIED live): `getServiceAuth` → `video.bsky.app` `uploadVideo` → poll `getJobStatus` until a blob → `app.bsky.embed.video`. Optional `metadata.aspectRatio {width,height}`. Size/duration limits and job state names are not in the tutorial, so only a missing blob or an explicit failed state is acted on; mp4 recommended.
- Deterministic `rkey` derived from the idempotency key → exact reconcile via `getRecord`.
- Metrics via public appview `getPosts` (likes, reposts, replies, quotes) and `getProfile` (followers).

### Mastodon  (credentials)
Verified (docs.joinmastodon.org): the user creates an app + access token on their own instance (scopes `write:statuses write:media read:accounts`), so no per-instance app registration.
- `Idempotency-Key` header (kept 1 h); async media (`/api/v2/media` 202 → poll). Limits are per instance (`/api/v2/instance`), read at connect; defaults 500 characters / 4 attachments (overruns are warnings in validation, enforced at publish).
- Reconcile by matching stripped HTML text. Metrics: favourites, reblogs, replies; followers.
- Instance URL is SSRF-guarded: https, public DNS hostnames only (no IP literals, ports, credentials, localhost/internal suffixes).

### Telegram  (credentials: bot token + channel)
Verified (core.telegram.org/bots/api): `sendMessage` (≤4096), `sendPhoto` / `sendVideo` by URL (caption ≤1024; photo ≤5 MB, other ≤20 MB by URL). The bot must be a channel administrator.
- 1 media, or an album of 2-10 photos/videos (sendMediaGroup, caption on the first item); plain text (no parse_mode). No reconcile and no post analytics (Bot API has neither); only metric: member count.

### Deliberately not built
Reddit (commercial API approval), Snapchat (no organic posting API), WhatsApp and Discord (messaging, not social posting), Tumblr (optional later). Also not built: competitors beyond X/YouTube, LinkedIn analytics/org posting, video transcoding, X threads/polls, Instagram account time series.

## Competitor intelligence (X, YouTube)
Public data only, read through the official API with one of your own connected accounts. Instagram (needs Facebook Login) and LinkedIn do not offer this to these integrations → `422 CAPABILITY_UNSUPPORTED`. Competitor analytics are never mixed with your private analytics: comparisons use only publicly visible counts (likes, comments, reposts, quotes). Hidden counts are `null`, not 0.

## Adding a platform
Implement `SocialAdapter` in `src/integrations/<platform>/` (auth, publisher, rules), register it in `src/composition.ts`, add the name to `PLATFORMS` (and a migration widening the `social_accounts.platform` CHECK), set `oauth: NO_OAUTH` + `credentials` for non-OAuth platforms, reuse `core/http.ts`, add the rules to `src/integrations/rules.ts`. Map every failure to a `PlatformError`; use `platformFetch(..., { creates: true })` for the request that creates the post.

## Token security
AES-256-GCM (WebCrypto), per-row AAD binding, key ring for rotation (`TOKEN_ENC_KEYS="2:<b64>,1:<b64>"`, first entry encrypts). Generate: `openssl rand -base64 32`.
API schemas and repository column lists never include credential columns.
