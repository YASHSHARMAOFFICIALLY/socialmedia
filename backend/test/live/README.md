# Live platform tests (opt-in)

`npm run test:live` calls the REAL platform APIs through the same adapters the app uses. Nothing here runs in `npm test`/CI.

Provide, per platform, a valid **user access token** (obtain it by completing the OAuth flow once, e.g. through a dev deployment) and the client credentials where noted:

| Platform | Env vars | Read-only checks | Publishing check (opt-in) |
|---|---|---|---|
| LinkedIn | `LIVE_LINKEDIN_TOKEN` | account lookup (userinfo) | `LIVE_ALLOW_PUBLISH=true` posts a text post |
| X | `LIVE_X_TOKEN` | account lookup, account metrics | `LIVE_ALLOW_PUBLISH=true` posts a text post |
| YouTube | `LIVE_YOUTUBE_TOKEN` | channel lookup, channel metrics | (video upload: use the app, it needs a media file) |
| Instagram | `LIVE_INSTAGRAM_TOKEN` (long-lived) | account lookup, follower count | (needs a public image URL: use the app) |

`LIVE_ALLOW_PUBLISH=true` creates a REAL public post titled `[automated test] <timestamp>` on the connected account: use a sandbox/test account.
The tests never print tokens. A failing test here means a platform contract differs from what the adapter assumes: fix the adapter and its mocked tests.
