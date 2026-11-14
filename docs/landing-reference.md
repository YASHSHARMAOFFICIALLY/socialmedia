# Landing page reference (from screenshots, 2026-11-14)

Sources: Postiz (postiz.com), Ribbon (meetribbon.app), TapMac.
Frontend today = bare `page.tsx`. This is the checklist for building it.

## 1. Bento cards

**Postiz — "Via <tool>" grid (dark, big color cards)**
- 2-column grid, each card = one way to use product: ChatGPT, Claude, Claude Code, Grok Bot, Hermes/OpenClaw (Telegram), Muse.
- Card: logo icon + "Via X" huge heading (~56px) + one-line benefit + real UI mock inside (chat window, terminal, Telegram).
- Mock shows the *outcome*: 3 posts (LinkedIn/X/Instagram) with times "Tue 10:00 AM", "Done. All 3 posts are scheduled".
- Alternating heading position: top on one card, bottom on the next. Makes the grid feel less repetitive.
- Each card its own gradient (purple, magenta, royal blue). Radius ~40px.
- Last card full-width: "Automate everything" + Postman-style API request (`POST /public/v1/posts`). Mentions Public API, n8n, Make, Zapier.
- Sticky nav: AI Agents ▾, Dev Docs, Channels ▾, News, Blog, Pricing | Log In | "Start for $0 »".
- Floating "Discord Support" pill bottom-right.

**TapMac — "Small app. Thoughtful details." (light, quiet)**
- Heading: bold sans + italic serif mix.
- Grid 3 columns: one wide card (2 cols) + four normal cards.
- Each card = small *interactive-looking* visual on top (key cap `return ↩`, `fn`, segmented control Desk/Stand/Lap, list of tap counts with dots) + bold title + 2-3 line gray body.
- Titles are plain benefits: "Send hands-free", "Private by design", "A light tap is plenty".
- Light gray cards (#f4f4f5-ish) on white, no borders, no shadows.

**For us:** Postiz-style "Via Claude / Via ChatGPT / Via Claude Code / Via API" grid fits our MCP angle exactly. Use TapMac-style small grid for detail features (scheduling, approvals, analytics, multi-workspace). Mocks must show real product output, not abstract icons.

## 2. FAQ (Ribbon)

- Two-column: left sticky = "FAQs" title + one-line topic summary + help link. Right = accordion.
- First item open by default. Chevron right, thin dividers, no card boxes.
- "Ask AI about Ribbon" row: icon buttons for ChatGPT, Claude, Perplexity, Grok, Gemini — each opens that AI with a prompt about the product. Plus an `.md` button (raw markdown of the page for LLMs).
- Questions are real search queries: "What is X?", "How is X different from Y?", "Is there a free trial?", "Does X run on Y?", "What happens if I quit X?", licensing/moving.
- Answers short (2-3 sentences), plain words, answer first.

**For us:** 8-10 questions: What is <product>? Which platforms? How is it different from Buffer/Postiz/Hootsuite? Does it work with Claude/ChatGPT (MCP)? Is there a free plan? Can it post without me confirming? (no — signed confirmation code). Pricing per workspace? Data/privacy? Use native `<details>/<summary>` + FAQPage JSON-LD.

## 3. Footer

**Postiz (dark, link-heavy SEO footer)**
- Left: logo + one-line tagline ("Agentic social media scheduler (cloud / open-source)") + social icons (GitHub, Discord, LinkedIn, FB, YouTube, IG, TikTok).
- Columns: Tools (API, N8N node, Make integration, Free Marketing Tools) / AI Agents (ChatGPT, Claude, Claude Code, Codex, Cursor, Gemini, Grok, DeepSeek, Kimi, Manus…, each with logo) / Resources (Blog, GitHub, Docs, Channels, Compare, Alternatives, Reviews, Roadmap, Discord, Affiliate) / Company (About, Contact, Enterprise, Pricing, Terms, Privacy, Data Processor, Uptime Monitor, Hiring).
- Every "AI Agents" link = its own landing page (one per integration = programmatic SEO).

**Ribbon (light, minimal, SEO-heavy)**
- Left: logo + one-sentence description + support email + scrolling badge marquee (Product Hunt, PickMacApps…) with pause button.
- Top row links: Pricing, Download, Shortcuts, Guides, Changelog, License, Privacy, Terms, Refunds.
- COMPARE column: "Ribbon vs yabai", "Ribbon vs AeroSpace"… (one page each).
- GUIDES column: ~25 links — "X alternatives", "Best X", "X for Mac", "How to <task>", "Troubleshooting". Every one is a search-intent page.
- Bottom bar: © year · platform requirements · "Built on top of Paneru".

## 4. SEO playbook (what makes them good)

1. **Page per search intent** — footer is the internal-link hub. Three page types:
   - `/vs/<competitor>` — "<us> vs Buffer", "vs Hootsuite", "vs Later", "vs Postiz", "vs Typefully".
   - `/alternatives/<competitor>` — "Buffer alternatives", "Hootsuite alternatives".
   - `/integrations/<agent>` — "Schedule posts from Claude", "…from ChatGPT", "…Cursor", "…n8n".
   - `/guides/<topic>` — "How to schedule LinkedIn posts", "Best time to post on X", "Instagram scheduler", etc.
   - `/channels/<platform>` — one per network we support.
2. **LLM-friendly**: "Ask AI about us" buttons, `.md` version of pages, `/llms.txt`. AI answers are a traffic source now.
3. **FAQ with JSON-LD** (`FAQPage`), plus `SoftwareApplication` + `Organization` schema on home.
4. **Trust**: badges (Product Hunt etc.), GitHub, uptime page, changelog, roadmap, reviews page.
5. **Next.js basics**: `metadata` per route (title/description/OG), `app/sitemap.ts`, `app/robots.ts`, `opengraph-image.tsx`, canonical URLs, static rendering for all marketing pages.
6. **Copy**: benefit headings, short body, plain words. No "Unlock / Supercharge / Seamless".

## 5. Build order

1. Home: hero → "Via X" bento → detail bento → FAQ → footer.
2. `sitemap.ts`, `robots.ts`, per-page metadata, JSON-LD.
3. Programmatic pages from one data file (`competitors.ts`, `integrations.ts`, `channels.ts`) → `[slug]` routes.
4. Guides/blog (MDX) last.

## 6. Product features to sell (from backend/docs/PROGRESS.md, 2026-11-14)

Rule (user): **someone reading only the hero must understand the whole product**: what it is, which platforms, AI/MCP angle, scheduling + analytics, team approval. Rest of page = proof and detail.

Hero must say, in plain words:
- One place to write, schedule, publish and measure posts on 11 networks.
- Works from Claude, ChatGPT, Cursor, terminal (MCP + CLI) and API. AI never posts without your confirmation.
- Honest analytics + insights with evidence; team approvals.
- Show the 11 platform logos in/under hero.

Feature inventory (group into "Via X" bento + detail bento + FAQ):
- **Platforms (11):** Instagram, X, LinkedIn, YouTube, Threads, Facebook Pages, Pinterest, TikTok, Bluesky, Mastodon, Telegram. Formats: X threads + polls, IG carousels (incl. video) + Reels, YouTube video + thumbnail + scheduled release, Telegram albums, Pinterest video pins, Bluesky video.
- **Create:** one post, tweak per account (caption/title/hashtags/media); drafts, labels, duplicate, search; pre-publish check against each platform's limits; bulk create/schedule/cancel; AI rewrite per platform (Claude), never auto-published.
- **Publish reliably:** retries, no double posts, confirms with platform when outcome unknown.
- **Schedule:** exact time or local time any timezone (DST safe); calendar month/week/range; clash warning (same account <5 min); recurring daily/weekly/monthly; >6h overdue never posted silently.
- **Media:** library, upload checks, image resize/convert, short video re-encode, per-platform fit check.
- **Analytics:** auto-collected likes/comments/views/followers etc.; overview, per platform/account/post, trends, follower growth, top posts, comparisons; cross-platform totals only for comparable metrics; IG demographics, YouTube watch time, FB/TikTok/Pinterest stats; data freshness per platform.
- **Insights:** best platform, best format, best posting time, engagement change, consistency. Each shows evidence; hidden until enough data.
- **Campaigns:** group posts, performance, compare campaigns. **Competitors:** public X + YouTube data.
- **Team:** workspaces, roles (owner/admin/editor/analyst/viewer), email invites, optional approval flow (writer, reviewer, publisher; edits void approval), audit log.
- **Notify + report:** in-app + email alerts, outbound webhooks, CSV + PDF reports.
- **AI + developers (lead angle):** MCP server for Claude/ChatGPT/Cursor (read analytics, draft, publish with signed confirmation code); browser or device-code login; `distora` CLI; REST API with docs.
- **Billing:** per-workspace plans via Dodo Payments. Prices are placeholders; don't show numbers until real.

Don't claim: LinkedIn company pages/analytics, Reddit, Snapchat, long-video transcoding. Nothing is live-verified yet; avoid "trusted by" / user-count claims.
