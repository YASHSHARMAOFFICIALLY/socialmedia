// All landing copy. The example data shown inside the product screens lives with each demo (stageshow/).
// Claims must be backed by backend/docs/PROGRESS.md. Screen data is example content with placeholder
// account names, never invented customers or statistics.

export const productName = "PostRally";

export const nav = [
  { label: "Product", href: "/#what" },
  { label: "Features", href: "/#more" },
  { label: "Integrations", href: "/#integrations" },
  { label: "Compare", href: "/#compare" },
  { label: "Pricing", href: "/#pricing" },
  { label: "FAQ", href: "/#faq" },
] as const;

export const platforms = [
  "Instagram", "X", "LinkedIn", "YouTube", "Threads", "Facebook",
  "Pinterest", "TikTok", "Bluesky", "Mastodon", "Telegram",
] as const;

export const hero = {
  // Line 1 in bold sans, line 2 in italic serif (TapMac's pairing). Words rise in one by one.
  lines: ["One post. Every platform.", "All under control."],
  body: "Write once, tailor it for each network, schedule it and see how it did.",
  signup: "Get started for free",
  primary: { label: "Explore the product", href: "#what" },
} as const;

export const demo = {
  id: "what",
  title: "Your entire publishing workflow,",
  titleAccent: "in one place.",
  body: "From first draft to performance report, without jumping between eleven apps.",
} as const;

export const product = {
  id: "product",
  calendar: {
    eyebrow: "Plan ahead",
    title: "Know what's going out,",
    titleAccent: "and when.",
    body: "Drag posts across the week. Clashes get flagged, timezones are handled.",
  },
  analytics: {
    eyebrow: "Measure what matters",
    title: "Don't just count your posts.",
    titleAccent: "Understand them.",
    body: "Likes and comments add up. Views stay per network, because each counts them differently.",
  },
} as const;

export const assistants = {
  id: "assistants",
  title: "Create and manage posts without leaving",
  titleAccent: "your AI workspace.",
  body: "Ask in plain words. Nothing goes live until you confirm.",
  // Five small working widgets (pattern from a reference bento: label + status pill on top, a live
  // widget in the middle, actions at the bottom). Every behaviour shown is a real PostRally behaviour.
  chat: {
    lead: "Ask in plain words.",
    rest: "Claude, ChatGPT, Cursor or Claude Code drafts and schedules. Nothing goes out until you confirm.",
    apps: [
      { name: "Claude", how: "Add as a connector." },
      { name: "ChatGPT", how: "Add as a connector." },
      { name: "Cursor", how: "postrally mcp login" },
      { name: "Claude Code", how: "postrally mcp login" },
    ],
    prompts: [
      { ask: "Which posts did best last month?", tool: "get_top_posts", reply: "Your launch carousel on Instagram, then the hiring post on LinkedIn. Both went out on a Wednesday evening." },
      { ask: "Turn it into a thread for X", tool: "create_draft_post", reply: "Drafted a 4-post thread under 280 characters each. Saved as a draft, nothing is out yet." },
      { ask: "Schedule it for Friday 10:00", tool: "prepare_publish", reply: "Preview ready: 3 posts on LinkedIn, X and Instagram, Fri 20 Nov at 10:00." },
    ],
    code: "K7Q-4MX",
    confirm: "Confirm",
    done: "Scheduled. 3 posts go out Fri 20 Nov at 10:00.",
    again: "Same code again: nothing new posted. Asking twice never posts twice.",
  },
  heatmap: {
    lead: "Stop guessing when to publish.",
    rest: "Your best days and hours per network, from your own history, after five posts.",
    pill: "Example account",
    days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    slots: ["08", "10", "13", "16", "18", "21"],
    // Example pattern only: each network peaks at a different day and hour.
    networks: [
      { name: "Instagram", color: "#d6249f", peak: [2, 4] },
      { name: "LinkedIn", color: "#0a66c2", peak: [1, 1] },
      { name: "X", color: "#111113", peak: [3, 2] },
    ],
    note: "Shown once a network has at least five posts.",
  },
  limits: {
    lead: "Every platform has its own rules.",
    rest: "PostRally checks your post against each network while you write. Type below and watch the limits.",
    pill: "Type to test",
    text: "Friday at 10:00 we ship the thing we've been building all year. Here's what's new.",
    // From backend/src/integrations/*/rules.ts (Mastodon: software default, instances can differ).
    networks: [
      { name: "X", max: 280 },
      { name: "Bluesky", max: 300 },
      { name: "Threads", max: 500 },
      { name: "Mastodon", max: 500 },
    ],
  },
  zones: {
    lead: "Pick a time. Post at the right time, everywhere.",
    rest: "Timezones and daylight saving are converted for you.",
    pill: "DST handled",
    // UTC offsets on 20 Nov 2026 (all outside daylight saving then).
    // ponytail: fixed offsets for one example date; the product uses the tz database.
    list: [
      { city: "Berlin", tz: "Europe/Berlin", offset: 1 },
      { city: "New York", tz: "America/New_York", offset: -5 },
      { city: "Tokyo", tz: "Asia/Tokyo", offset: 9 },
      { city: "São Paulo", tz: "America/Sao_Paulo", offset: -3 },
    ],
  },
} as const;

// "Features": a dashboard-style bento (sections/more.tsx). The example data inside the cards lives there;
// this list is what a screen reader gets instead of the pictures. Every item is a real PostRally feature.
export const more = {
  title: "The tools you'll appreciate",
  titleAccent: "once you start using them.",
  features: [
    "Campaign results with CSV and PDF reports.",
    "A queue of what goes out next, per network.",
    "Team approvals. Editing an approved post sends it back for review.",
    "Connection health, with an alert before a network needs reconnecting.",
    "Signed webhooks that retry, a CLI and a REST API.",
    "Five workspace roles: Owner, Admin, Editor, Analyst, Viewer.",
    "A media library that checks each file against each network.",
    "Bulk scheduling from a CSV file.",
    "Public numbers for competitors on X and YouTube.",
  ],
} as const;

export const pricingSection = {
  id: "pricing",
  title: "Pay per workspace,",
  titleAccent: "not per person.",
  body: "Start free. Every paid plan has a free trial.",
  link: "Pricing questions",
} as const;

export const faq = {
  title: "FAQs",
  intro: "Networks, AI assistants, scheduling, analytics and pricing.",
  items: [
    { q: "What is PostRally?", a: "A social media publishing and management platform. Create content, adapt it for multiple networks, schedule posts and understand their performance from one workspace." },
    { q: "Which social networks does PostRally support?", a: "Instagram, X, LinkedIn, YouTube, Threads, Facebook Pages, Pinterest, TikTok, Bluesky, Mastodon and Telegram. LinkedIn company page publishing is not supported yet." },
    { q: "Do I need to use AI to use PostRally?", a: "No. You can manage everything in the PostRally app. The AI integrations are optional." },
    { q: "Can I publish the same content on multiple platforms?", a: "Yes. Start with one post, create a version for each network, review them and schedule them from the same composer." },
    { q: "Can I schedule posts in advance?", a: "Yes. Schedule posts for a date and time, set them to repeat daily, weekly or monthly, and manage everything in the publishing calendar." },
    { q: "Does PostRally handle different timezones?", a: "Yes. PostRally converts timezones and handles daylight saving changes when it schedules a post." },
    { q: "Can I use PostRally with ChatGPT or Claude?", a: "Yes, through MCP. For Cursor and Claude Code there is also a CLI: run postrally mcp login once." },
    { q: "Can an AI assistant publish without my permission?", a: "No. Publishing through an assistant needs a confirmation code that comes with the preview. You review the prepared posts before you confirm." },
    { q: "Can my team approve posts before they go live?", a: "Yes. Workspaces support approvals with separate roles and a reviewer requirement. Editing an approved post sends it back for review." },
    { q: "How does PostRally calculate analytics across platforms?", a: "It combines metrics that mean the same thing on every network, such as likes, comments and followers. Views and reach stay separate because each network counts them differently." },
    { q: "When do best-time recommendations become available?", a: "After at least five posts have been published on a network." },
    { q: "What happens if a scheduled post fails?", a: "PostRally retries it. If a post is more than six hours late, it waits for you instead of publishing late without telling you." },
    { q: "How much does PostRally cost?", a: "There is a free plan. Paid plans start at $15 a month, or ₹999 in India, with two months free on yearly billing. Every paid plan starts with a 7-day free trial, and plans are per workspace, not per person." },
  ],
} as const;

export const closing = {
  title: "More creating. Less posting admin.",
  body: "Spend your time on the content, not the posting.",
  cta: "Create your account",
} as const;

export const footer = {
  description: "Your social media publishing workspace. Create once, publish across platforms and understand what works.",
} as const;

// "Ask AI about PostRally" (Ribbon's footer row): each link opens the assistant with this prompt filled
// in. The prompt carries the facts itself, so the answer doesn't depend on the AI finding the site.
// Facts from backend/docs/PROGRESS.md, same as the rest of the page.
export const askAi = {
  title: "Ask AI about PostRally",
  prompt: [
    "I'm looking at PostRally, a social media scheduler. This is what it says it does:",
    "- Write one post and tailor it per account for Instagram, X, LinkedIn (personal profiles), YouTube, Threads, Facebook Pages, Pinterest, TikTok, Bluesky, Mastodon and Telegram.",
    "- Checks each version against that network's limits before it goes out.",
    "- Schedules at a local time in any timezone, handles daylight saving, warns about clashing posts and supports daily, weekly or monthly repeats.",
    "- Analytics adds up only comparable numbers (likes, comments, followers); views and reach stay per network. Best network, format and posting time appear after five posts per network.",
    "- Optional team approval: writer, reviewer, publisher. Editing an approved post sends it back for review.",
    "- Works from Claude, ChatGPT and Cursor through a remote MCP server, plus a CLI and a REST API with signed webhooks.",
    "- An AI assistant can't publish without a confirmation code from the preview, which expires after ten minutes.",
    "- Pricing is per workspace: a free plan, then Starter from $15 a month (₹999 in India), Pro and Agency. Every paid plan has a 7-day free trial and can be cancelled anytime.",
    "Explain who PostRally suits, what it is good and weak at, and how it compares with Buffer, Hootsuite and Later.",
  ].join("\n"),
  // URL formats that open each assistant with the prompt filled in.
  links: [
    { name: "ChatGPT", url: "https://chatgpt.com/?q=" },
    { name: "Claude", url: "https://claude.ai/new?q=" },
    { name: "Perplexity", url: "https://www.perplexity.ai/search?q=" },
    { name: "Grok", url: "https://grok.com/?q=" },
  ],
} as const;
