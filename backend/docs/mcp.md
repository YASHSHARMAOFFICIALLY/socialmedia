# MCP (Model Context Protocol)

Official SDK: `@modelcontextprotocol/server` **2.x** (the stable line, spec 2026-07-28). The server is **stateless** (a new `McpServer` per request, JSON responses), so it needs no sticky sessions or shared memory and runs on Cloudflare Workers. REST and MCP call the **same services**; MCP adds no business logic.

## Remote: `POST /mcp` (Streamable HTTP)
`Authorization: Bearer <token>` is required (never in URLs). 401 carries `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/mcp"`. Foreign `Origin` headers get 403. Limits: 600/min per IP, 120/min per credential.

Every tool, resource and prompt runs this gate, in order: **token scope → workspace → plan entitlement**.
- The workspace is never trusted from the caller. Tokens are bound to one workspace; arguments cannot widen that. Membership is re-checked on every call (a removed member's token stops working at once; strangers get `NOT_FOUND`, not `FORBIDDEN`).
- The `mcp_access` entitlement is checked after membership (another tenant's plan is not revealed). Free plan: `PLAN_LIMIT_REACHED`. Billing read tools are exempt so users can see why.
- Role permissions still apply (an analyst cannot read billing via MCP).
- Calls are audited as `mcp.tool_call` (name, outcome, client id only; never arguments or results).
- Errors come back as tool results with `isError` and `{error:{code,message,details}}`.

### Credentials
Three ways to authenticate:
1. **Personal access token** (`dsp_…`): `POST /workspaces/{ws}/mcp/tokens {name, scopes, expiresInDays≤90}` (owner/admin). Shown once; stored as SHA-256. For clients that accept a static header.
2. **Device authorization (RFC 8628)** for the CLI: `POST /mcp/device` → user opens `/mcp/device?user_code=…` while signed in (plain HTML page), picks a workspace, approves → `POST /mcp/token` (device_code grant) returns a 1-hour access token (`dsa_…`) and a rotating 30-day refresh token (`dsr_…`). Reusing an already-rotated refresh token revokes the whole grant.
3. **Browser OAuth 2.1** (authorization code + PKCE S256, dynamic client registration RFC 7591, metadata RFC 8414/9728) for hosts such as Claude and Cursor: the client registers at `POST /mcp/register`, sends the user to `GET /mcp/authorize` (server-rendered consent page; needs the user's signed-in cookie in that browser and an owner/admin workspace), the user picks a workspace and allows, the client gets a single-use 60 s code on its registered `redirect_uri` and trades it at `POST /mcp/token` (`authorization_code`) for the same access/refresh tokens as the device flow. Redirect URIs are matched exactly (https, loopback http, or an app scheme); default scopes exclude `billing:portal`. The consent POST refuses cross-site origins. If the browser is not signed in, `/mcp/authorize` redirects (302) to `${APP_URL}/login?next=<this authorize URL>`; the login page must send the user back to `next` after sign-in (only same-origin `next` values should be followed). Without `APP_URL` it answers 401.
Revoke: `DELETE /workspaces/{ws}/mcp/tokens/{id}` (kills all its tokens). Scopes: `accounts:read analytics:read content:read content:write content:publish billing:read billing:portal` (default grant = the read scopes; `content:write`, `content:publish` and `billing:portal` must be requested).

Better Auth's `@better-auth/mcp` plugin was not used (it needs its own tables and a login UI); this flow is hand-built on the same grants as the device flow.

## Contracts (read-only except the two noted tools; annotated `readOnlyHint`)
Content: `get_post` (read) and `create_draft_post` (scope `content:write`, NOT granted by default; editor role or above; creates a draft only, never publishes or schedules; annotated not read-only). Analytics: `list_social_accounts`, `get_analytics_overview`, `get_account_analytics`, `get_post_analytics`, `get_top_posts`, `compare_platform_performance`, `get_follower_growth`, `get_engagement_trends`, `list_recent_posts`. Results carry `freshness` (last collection per platform). `null` metric = unavailable, never zero; non-comparable metrics are never summed; ranges max 366 days.
Billing: `get_subscription`, `get_current_plan`, `get_usage_summary`, `list_invoices` (payment records), `get_available_plans`, `create_billing_portal_session` (owner only; link created on demand).
Resources: `social://accounts`, `analytics://overview`, `analytics://top-posts`, `analytics://metric-definitions`, `billing://subscription`, `billing://usage` (optional `?workspaceId=`).
Prompts: `weekly-performance-review`, `cross-platform-content-analysis`, `content-repurposing`, `subscription-usage-review`. They fetch real data and keep a FACTS block separate from a "Recommendations (my suggestions, not data)" heading.
Publishing (scope `content:publish`, `publish:create` permission, plan `posts_per_month` limit as in REST):
- `prepare_publish {postId, accountIds?, scheduledAt? | localDateTime?, timezone}` creates nothing; returns the text, destinations with blockers, resolved time and a `confirmationCode` valid 10 minutes. The code is an HMAC (key derived from `BETTER_AUTH_SECRET`) over workspace, user, post, destination set, time and a fingerprint of the post's content.
- `publish_post {same args, confirmationCode}` (annotated `destructiveHint`/`openWorldHint`, so hosts ask the user) refuses a code for other arguments (`CONFIRMATION_INVALID`) or after an edit/expiry (`CONFIRMATION_STALE`). The code is also the Idempotency-Key: repeating the call returns the first result with `replayed: true`.
- Limit: the server cannot ask the user itself (stateless JSON transport, no elicitation); the confirmation is the preview step plus the host's approval prompt. Cancel/reschedule over MCP is not built. Post titles/bodies in results are third-party text: tool descriptions tell the model to treat them as data.

Add a tool: create it with `defineTool({name, scope, input, handler})` in a tools file and list it in `TOOLS` (`mcp.server.ts`).

## Local: `postrally` CLI (`cli/`)
A stdio bridge that forwards to remote `/mcp`, so tool contracts are identical. It holds no database or platform credentials.
```
postrally mcp login --api-url https://api.example.com   # device flow; opens the browser
postrally mcp status | logout
postrally mcp serve                                      # what the MCP client launches
```
Credentials: macOS Keychain (`security`), Linux Secret Service (`secret-tool`), else a 0600 file. `POSTRALLY_TOKEN` + `POSTRALLY_API_URL` override for CI/headless (a PAT). All logs go to stderr; stdout is protocol only. Refresh tokens rotate and are saved before use.
Client config (Claude Desktop / Cursor / Claude Code):
```json
{ "mcpServers": { "postrally": { "command": "npx", "args": ["-y", "postrally", "mcp", "serve"] } } }
```
Remote with a PAT (clients supporting headers): `{"type":"http","url":"https://api.example.com/mcp","headers":{"Authorization":"Bearer dsp_…"}}`.

## Not verified
Runs in tests through the real SDK (in-memory fetch + a real stdio subprocess). The Worker bundles (`npm run build`) without `new Function`. **Not run on workerd, not against a real MCP host, macOS Keychain / Secret Service code not exercised, CLI not published to npm.**
