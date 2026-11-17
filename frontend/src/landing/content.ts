// All landing copy. The example data shown inside the product screens lives with each demo (stageshow/).
// Claims must be backed by backend/docs/PROGRESS.md. Screen data is example content with placeholder
// account names, never invented customers or statistics.

export const productName = "PostRally";

export const nav = [
  { label: "Product", href: "/#what" },
  { label: "Try it", href: "/#assistants" },
  { label: "Integrations", href: "/#integrations" },
  { label: "Compare", href: "/#compare" },
  { label: "FAQ", href: "/#faq" },
] as const;

export const platforms = [
  "Instagram", "X", "LinkedIn", "YouTube", "Threads", "Facebook",
  "Pinterest", "TikTok", "Bluesky", "Mastodon", "Telegram",
] as const;

export const hero = {
  // Line 1 in bold sans, line 2 in italic serif (TapMac's pairing). Words rise in one by one.
  lines: ["A post, written once,", "lands everywhere."],
  body: "Tailor it for eleven networks, schedule it and see how it did, from the app or straight from Claude, ChatGPT and Cursor.",
  primary: { label: "See what it does", href: "#what" },
} as const;

export const demo = {
  id: "what",
  title: "What is",
  titleAccent: "PostRally?",
  body: "One composer for every network. Write the post, adjust it per account, check it against each network's limits, then schedule it.",
} as const;

export const product = {
  id: "product",
  calendar: {
    eyebrow: "Plan",
    title: "Your week,",
    titleAccent: "in your timezone.",
    points: [
      "Pick a local time and daylight saving is handled for you.",
      "Two posts on one account within five minutes? You get a warning first.",
      "Repeat a post daily, weekly or monthly.",
      "A post more than six hours late waits for you instead of going out quietly.",
    ],
  },
  analytics: {
    eyebrow: "Measure",
    title: "Numbers that",
    titleAccent: "mean the same thing.",
    points: [
      "Likes, comments and followers add up across networks.",
      "Views and reach are counted differently on each network, so they stay side by side.",
      "Best network, format and posting time, each shown with the posts behind it.",
      "Insights wait until there are at least five posts per network.",
    ],
  },
} as const;

export const assistants = {
  id: "assistants",
  title: "Go on,",
  titleAccent: "press the buttons.",
  body: "Each card is a small working piece of PostRally: the assistant, the team approval step, the best-time heatmap, the per-network checks and the timezone maths.",
  // Five small working widgets (pattern from a reference bento: label + status pill on top, a live
  // widget in the middle, actions at the bottom). Every behaviour shown is a real PostRally behaviour.
  chat: {
    lead: "Ask in plain words.",
    rest: "Claude, ChatGPT, Cursor or Claude Code drafts and schedules. Nothing goes out until you confirm.",
    apps: [
      { name: "Claude", how: "Add PostRally as a connector, sign in in the browser." },
      { name: "ChatGPT", how: "Add PostRally as a connector, sign in in the browser." },
      { name: "Cursor", how: "Run postrally mcp login once. The token goes in your keychain." },
      { name: "Claude Code", how: "Run postrally mcp login once. The token goes in your keychain." },
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
  approvals: {
    lead: "Nothing slips through.",
    rest: "A reviewer approves, and editing an approved post sends it back.",
    steps: ["Written", "Reviewed", "Scheduled"],
    approve: "Approve",
    edit: "Edit after approval",
    states: [
      { pill: "Needs review", text: "The writer sent it. One reviewer has to approve, and it can't be the writer." },
      { pill: "Approved", text: "Approved. It goes out Fri 20 Nov at 10:00 unless someone changes it." },
      { pill: "Back in review", text: "It changed after approval, so it went back for review. Nothing slips through." },
    ],
  },
  heatmap: {
    lead: "Know when to post.",
    rest: "The best day and hour for each network, once it has five posts.",
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
    lead: "Checked per network.",
    rest: "Type, and see which limits you would break.",
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
    lead: "One 10:00, every timezone.",
    rest: "Daylight saving included.",
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

export const more = {
  title: "And the rest",
  items: [
    { name: "Team approvals", text: "Writer, reviewer, publisher. Editing an approved post sends it back." },
    { name: "Five roles", text: "Owner, admin, editor, analyst and viewer per workspace." },
    { name: "Campaigns", text: "Group posts and see how the campaign did as a whole." },
    { name: "Competitors", text: "Public numbers for accounts on X and YouTube." },
    { name: "Media library", text: "Uploads are checked against each network's formats." },
    { name: "Reports", text: "CSV and PDF exports for posts, accounts and campaigns." },
    { name: "Alerts", text: "Email and in-app, including when an account needs reconnecting." },
    { name: "Bulk scheduling", text: "Create, schedule or cancel many posts in one go." },
    { name: "CLI", text: "postrally mcp login for Cursor and Claude Code. The token lives in your keychain." },
    { name: "Webhooks", text: "HMAC-signed events, retried when your endpoint is down." },
  ],
} as const;

export const faq = {
  title: "FAQs",
  intro: "Networks, AI assistants, scheduling, analytics and pricing.",
  items: [
    { q: "What does PostRally do?", a: "It lets you write a post once, adjust it for each social account, schedule or publish it, and see how it performed. You can do all of that from an AI assistant like Claude or ChatGPT, from the terminal, or through the API." },
    { q: "Which networks can it post to?", a: "Instagram, X, LinkedIn, YouTube, Threads, Facebook Pages, Pinterest, TikTok, Bluesky, Mastodon and Telegram. LinkedIn company pages are not supported yet because they need partner approval from LinkedIn." },
    { q: "Can Claude or ChatGPT post without asking me?", a: "No. Publishing needs a confirmation code that comes with the preview the assistant shows you. The code expires after ten minutes, and repeating the same request never posts twice." },
    { q: "How do I connect it to my AI assistant?", a: "Claude, ChatGPT and other MCP clients connect to PostRally's remote MCP server and sign you in through the browser. For Cursor or Claude Code, run postrally mcp login in your terminal." },
    { q: "What happens if a post can't go out on time?", a: "PostRally retries with increasing gaps between attempts. If a post is more than six hours late, it waits for you instead of posting it late. If it can't tell whether a post went out, it checks with the network before trying again." },
    { q: "Why aren't views added up across networks?", a: "Each network counts a view differently, so a total would mix different things. PostRally adds up only metrics that mean the same everywhere, like likes, comments and followers, and shows the rest per network." },
    { q: "Can my team review posts before they go out?", a: "Yes. Turn on approvals for a workspace and choose how many reviewers a post needs. Nobody can approve their own post, and editing an approved post sends it back for review." },
    { q: "How much does it cost?", a: "Plans are per workspace. Prices are not final yet, and we'll publish them before anyone is charged." },
  ],
} as const;

export const closing = {
  title: "Write it once.",
  body: "Eleven networks, one composer, and your AI assistant when you want it. Prices are coming soon; until then you can try every part.",
  cta: "Create your account",
} as const;

export const footer = {
  description: "Write once, post to eleven social networks, and run it from your AI assistant.",
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
    "- Pricing is per workspace and not published yet.",
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
