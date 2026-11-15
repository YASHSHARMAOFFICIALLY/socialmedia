// All landing page copy lives here so sections stay layout-only.
// Source of truth for claims: backend/docs/PROGRESS.md. Do not add a claim that file does not back.

export const productName = "Distora";

export const nav = [
  { label: "Assistants", href: "#assistants" },
  { label: "Features", href: "#features" },
  { label: "FAQ", href: "#faq" },
] as const;

export const platforms = [
  "Instagram",
  "X",
  "LinkedIn",
  "YouTube",
  "Threads",
  "Facebook",
  "Pinterest",
  "TikTok",
  "Bluesky",
  "Mastodon",
  "Telegram",
] as const;

export const hero = {
  title: "Write it once. Post it to eleven networks.",
  body: "Distora tailors each post to every account, schedules it in any timezone and tracks how it did. Run it from Claude, ChatGPT, Cursor, your terminal or the API. Nothing goes live until you confirm it.",
  primary: { label: "See Claude schedule a post", href: "#assistants" },
  signupNote: "Sign-up opens soon.",
} as const;

// Hero collage: one launch post, tuned three ways. Example content, placeholder account name.
export const heroCollage = {
  note: "one post, tuned 3 ways",
  sticky: ["Fri 10:00", "all three, Berlin time"],
  posts: {
    linkedin: {
      network: "LinkedIn",
      account: "Your name",
      text: "We're launching on Friday. Here's what changed, and why we built it the way we did.",
      when: "Fri 10:00",
    },
    instagram: {
      network: "Instagram",
      account: "yourbrand",
      text: "Launch day is Friday. Swipe through what's new.",
      when: "Fri 10:00",
      image: true,
    },
    x: {
      network: "X",
      account: "Your brand",
      text: "Friday, 10:00. A short thread on what's new (1/4)",
      when: "Fri 10:00",
    },
  },
} as const;

export const assistants = {
  title: "Use it from the tools you already have open",
  body: "Distora runs a remote MCP server, so any MCP client can read your analytics, write drafts and schedule posts on your behalf.",
  chat: {
    title: "From Claude or ChatGPT",
    body: "Add Distora as a connector and sign in through your browser. Ask for last month's best posts, then have it draft the follow-up.",
    ask: "Which posts did best last month?",
    tool: "get_top_posts",
    answer: "Your top three by interactions:",
    results: ["Launch thread on X", "Behind-the-scenes Reel", "Hiring post on LinkedIn"],
  },
  // Output lines copied from backend/cli/src/main.ts.
  terminal: {
    title: "From Cursor or Claude Code",
    body: "Sign in once from the terminal. The CLI stores your token in the system keychain and serves the connection to your editor.",
    lines: [
      { prompt: true, text: "distora mcp login" },
      { prompt: false, text: "Open the link and confirm the code. Waiting for approval..." },
      { prompt: false, text: "Logged in (credentials stored in macOS Keychain)." },
      { prompt: true, text: "distora mcp serve" },
    ],
  },
  confirm: {
    title: "It asks before it posts",
    body: "The assistant shows you a preview with a code that expires in ten minutes, and can only post with that code. Asking twice never posts twice.",
    notes: ["preview + code", "you say yes", "it posts"],
  },
  api: {
    title: "From your own code",
    body: "Every feature is a REST endpoint with interactive docs, and HMAC-signed webhooks tell your systems when something happens.",
    request: "POST /workspaces/{workspaceId}/posts/{postId}/schedule",
    payload: '{\n  "localDateTime": "2026-11-20T10:00",\n  "timezone": "Europe/Berlin"\n}',
    response: "202 Scheduled",
  },
} as const;

export const features = {
  title: "Everything after you hit post",
  body: "Tailoring, scheduling, reviews, analytics and reports, in the same place.",
  tailor: {
    title: "One post, tuned for each network",
    body: "Write the post once, then change the caption, title, hashtags or media per account. Each version is checked against that network's limits before it goes out.",
    posts: [
      { network: "LinkedIn", account: "Your name", text: "The long version: what we changed and why.", when: "Fri 10:00" },
      { network: "X", account: "Your brand", text: "What's new, in four short posts (1/4)", when: "Fri 10:00" },
      { network: "Instagram", account: "yourbrand", text: "Four photos and a video.", when: "Fri 10:00", image: true },
    ],
  },
  schedule: {
    title: "Schedules in your timezone",
    body: "Pick a local time and Distora handles daylight saving. It warns you when one account has two posts within five minutes, and never quietly posts something six hours late.",
    zone: "Europe/Berlin",
    week: [
      { day: "Mon", post: "09:00" },
      { day: "Tue" },
      { day: "Wed", post: "18:00", repeat: true },
      { day: "Thu" },
      { day: "Fri", post: "10:00" },
      { day: "Sat" },
      { day: "Sun" },
    ] as Array<{ day: string; post?: string; repeat?: boolean }>,
    legend: "Wednesday repeats every week",
  },
  approvals: {
    title: "Reviews before anything goes live",
    body: "Turn on approvals and posts move from writer to reviewer to publisher. Editing an approved post sends it back for review.",
    steps: [
      { who: "Writer", done: true },
      { who: "Reviewer", done: true },
      { who: "Publisher", done: false },
    ],
  },
  analytics: {
    title: "Numbers that mean the same thing",
    body: "Likes, comments and followers add up across networks. Views and reach are counted differently on each one, so Distora shows them side by side instead of summing them.",
    rows: [
      { metric: "Likes", note: "added up" },
      { metric: "Comments", note: "added up" },
      { metric: "Views", note: "per network" },
      { metric: "Reach", note: "per network" },
    ],
  },
  insights: {
    title: "Insights that show their working",
    body: "Your best network, format and posting time, each with the posts behind it. An insight stays hidden until there are at least five posts per network to base it on.",
    card: { heading: "Best time to post", empty: "Needs 5 posts per network first", hint: "then shows the posts it used" },
  },
  more: {
    title: "And the rest",
    items: [
      "Recurring posts, daily, weekly or monthly",
      "Campaigns with their own performance view",
      "Competitor tracking on X and YouTube",
      "Media library with format checks",
      "CSV and PDF reports",
      "Email and in-app alerts",
      "Workspaces with five roles",
      "Bulk scheduling",
    ],
  },
} as const;

export const faq = {
  title: "FAQs",
  intro: "Networks, AI assistants, scheduling, analytics and pricing.",
  items: [
    {
      q: "What does Distora do?",
      a: "It lets you write a post once, adjust it for each social account, schedule or publish it, and see how it performed. You can do all of that from an AI assistant like Claude or ChatGPT, from the terminal, or through the API.",
    },
    {
      q: "Which networks can it post to?",
      a: "Instagram, X, LinkedIn, YouTube, Threads, Facebook Pages, Pinterest, TikTok, Bluesky, Mastodon and Telegram. LinkedIn company pages are not supported yet because they need partner approval from LinkedIn.",
    },
    {
      q: "Can Claude or ChatGPT post without asking me?",
      a: "No. Publishing needs a confirmation code that comes with the preview the assistant shows you. The code expires after ten minutes, and repeating the same request never posts twice.",
    },
    {
      q: "How do I connect it to my AI assistant?",
      a: "Claude, ChatGPT and other MCP clients connect to Distora's remote MCP server and sign you in through the browser. For Cursor or Claude Code, run distora mcp login in your terminal.",
    },
    {
      q: "What happens if a post can't go out on time?",
      a: "Distora retries with increasing gaps between attempts. If a post is more than six hours late, it waits for you instead of posting it late. If it can't tell whether a post went out, it checks with the network before trying again.",
    },
    {
      q: "Why aren't views added up across networks?",
      a: "Each network counts a view differently, so a total would mix different things. Distora adds up only metrics that mean the same everywhere, like likes, comments and followers, and shows the rest per network.",
    },
    {
      q: "Can my team review posts before they go out?",
      a: "Yes. Turn on approvals for a workspace and choose how many reviewers a post needs. Nobody can approve their own post, and editing an approved post sends it back for review.",
    },
    {
      q: "How much does it cost?",
      a: "Plans are per workspace. Prices are not final yet, and we'll publish them before sign-up opens.",
    },
  ],
} as const;

export const footer = {
  tagline: "Write once, post to eleven networks, and run it from your AI assistant.",
} as const;
