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
There is **no browser OAuth authorization-code flow** (it needs a login/consent UI; this backend has none). Instead:
1. **Personal access token** (`dsp_…`): `POST /workspaces/{ws}/mcp/tokens {name, scopes, expiresInDays≤90}` (owner/admin). Shown once; stored as SHA-256. For clients that accept a static header.
2. **Device authorization (RFC 8628)** for the CLI: `POST /mcp/device` → user opens `/mcp/device?user_code=…` while signed in (plain HTML page), picks a workspace, approves → `POST /mcp/token` (device_code grant) returns a 1-hour access token (`dsa_…`) and a rotating 30-day refresh token (`dsr_…`). Reusing an already-rotated refresh token revokes the whole grant.
Revoke: `DELETE /workspaces/{ws}/mcp/tokens/{id}` (kills all its tokens). Scopes: `accounts:read analytics:read content:read billing:read billing:portal`.

Gap vs. full MCP OAuth 2.1: clients that only speak the authorization-code + dynamic-registration flow cannot connect natively; use a PAT in the client's header config, or the CLI. Better Auth's `@better-auth/mcp` plugin could add that flow later but needs a login + consent page and its own tables (see "Decisions").

## Contracts (all read-only, annotated `readOnlyHint`)
Analytics: `list_social_accounts`, `get_analytics_overview`, `get_account_analytics`, `get_post_analytics`, `get_top_posts`, `compare_platform_performance`, `get_follower_growth`, `get_engagement_trends`, `list_recent_posts`. Results carry `freshness` (last collection per platform). `null` metric = unavailable, never zero; non-comparable metrics are never summed; ranges max 366 days.
Billing: `get_subscription`, `get_current_plan`, `get_usage_summary`, `list_invoices` (payment records), `get_available_plans`, `create_billing_portal_session` (owner only; link created on demand).
Resources: `social://accounts`, `analytics://overview`, `analytics://top-posts`, `analytics://metric-definitions`, `billing://subscription`, `billing://usage` (optional `?workspaceId=`).
Prompts: `weekly-performance-review`, `cross-platform-content-analysis`, `content-repurposing`, `subscription-usage-review`. They fetch real data and keep a FACTS block separate from a "Recommendations (my suggestions, not data)" heading.
Not built (future, per plan): content and publishing tools. Publishing needs explicit confirmation + idempotency first. Post titles/bodies in results are third-party text: tool descriptions tell the model to treat them as data.

Add a tool: create it with `defineTool({name, scope, input, handler})` in a tools file and list it in `TOOLS` (`mcp.server.ts`).

## Local: `distora` CLI (`cli/`)
A stdio bridge that forwards to remote `/mcp`, so tool contracts are identical. It holds no database or platform credentials.
```
distora mcp login --api-url https://api.example.com   # device flow; opens the browser
distora mcp status | logout
distora mcp serve                                      # what the MCP client launches
```
Credentials: macOS Keychain (`security`), Linux Secret Service (`secret-tool`), else a 0600 file. `DISTORA_TOKEN` + `DISTORA_API_URL` override for CI/headless (a PAT). All logs go to stderr; stdout is protocol only. Refresh tokens rotate and are saved before use.
Client config (Claude Desktop / Cursor / Claude Code):
```json
{ "mcpServers": { "distora": { "command": "npx", "args": ["-y", "distora", "mcp", "serve"] } } }
```
Remote with a PAT (clients supporting headers): `{"type":"http","url":"https://api.example.com/mcp","headers":{"Authorization":"Bearer dsp_…"}}`.

## Not verified
Runs in tests through the real SDK (in-memory fetch + a real stdio subprocess). The Worker bundles (`npm run build`) without `new Function`. **Not run on workerd, not against a real MCP host, macOS Keychain / Secret Service code not exercised, CLI not published to npm.**
