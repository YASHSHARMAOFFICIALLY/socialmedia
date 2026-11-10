# Social Distribution & Intelligence Backend

Create once, customize per platform, publish everywhere (Instagram, X, LinkedIn, YouTube, Threads, Facebook Pages, Pinterest, TikTok, Bluesky, Mastodon, Telegram; the last seven are mocked-API tested only, TikTok unverified), schedule, and analyze everything in one place.
TypeScript · Express on Cloudflare Workers · Neon Postgres (raw SQL) · Cloudflare Queues/R2/KV · Better Auth · Zod · Pino · Vitest.

```bash
npm install
npm test                 # ~300 tests: in-process Postgres (PGlite), mocked platform APIs — no Docker, no credentials
npm run typecheck
npm run build            # wrangler dry-run bundle

# run locally (needs a Postgres, e.g. a free Neon branch)
cp .env.example .dev.vars               # fill secrets
export DATABASE_URL=postgres://...      # direct Neon URL
npm run migrate
export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=$DATABASE_URL
npm run dev                             # http://localhost:8787  (/docs = Swagger UI)
```

* Production: `docs/deployment.md` (requires Workers Paid; never deployed yet — see its verification checklist)
* Architecture: `docs/architecture.md` · Schema: `docs/database-schema.md` · API: `docs/api-documentation.md`
* Platform capabilities, API limits and external approval gates: `docs/integrations.md`
* Progress, decisions, known limitations: `docs/PROGRESS.md`
* Billing (Dodo Payments, entitlements, usage): `docs/billing.md` · MCP (remote `/mcp`, `distora` CLI): `docs/mcp.md`
