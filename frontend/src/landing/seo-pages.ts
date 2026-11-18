// One data file for the search-intent pages linked from the footer (docs/landing-reference.md §4):
// /integrations/<slug> ("schedule posts from Claude") and /channels/<slug> ("Instagram scheduler").
// Facts only from backend/docs/PROGRESS.md and the integration rule files. Compare and guide pages
// come later; they are not linked until they exist.

export type SeoPage = {
  slug: string;
  name: string;
  /** The product's own site. Footer links and the page's secondary button go here. */
  site?: string;
  title: string; // <title> and h1
  description: string; // meta description and intro
  points: string[];
  steps?: string[];
};

export const integrations: SeoPage[] = [
  {
    slug: "claude",
    name: "Claude",
    site: "https://claude.ai",
    title: "Schedule social media posts from Claude",
    description: "Connect PostRally to Claude and ask in plain words: read your analytics, draft posts for each network and schedule them. Nothing goes out until you confirm.",
    points: [
      "Ask which posts did best, by network, format or posting time.",
      "Draft a post or a thread and keep it as a draft until you're ready.",
      "Schedule across 11 networks in your own timezone.",
      "Publishing needs a confirmation code from the preview. It expires after ten minutes.",
      "Asking twice never posts twice: the code doubles as a replay key.",
    ],
    steps: ["Add PostRally as a connector in Claude.", "Sign in through your browser.", "Ask for what you need. Claude shows a preview before anything is published."],
  },
  {
    slug: "chatgpt",
    name: "ChatGPT",
    site: "https://chatgpt.com",
    title: "Schedule social media posts from ChatGPT",
    description: "Use PostRally inside ChatGPT to check how your posts did, draft new ones per network and schedule them, with a confirmation step before anything is published.",
    points: [
      "Read analytics across Instagram, X, LinkedIn, YouTube and more.",
      "Draft one post and adjust it per account.",
      "Schedule at a local time; daylight saving is handled.",
      "Every publish shows a preview and needs a code that expires after ten minutes.",
    ],
    steps: ["Add PostRally as a connector in ChatGPT.", "Sign in through your browser.", "Ask in plain words and confirm the preview."],
  },
  {
    slug: "cursor",
    name: "Cursor",
    site: "https://cursor.com",
    title: "Schedule social media posts from Cursor",
    description: "Run the PostRally CLI once and Cursor can draft, check and schedule your posts through PostRally's MCP server while you work.",
    points: [
      "Sign in once with postrally mcp login.",
      "The token is kept in your system keychain.",
      "Draft release posts next to the code you're shipping.",
      "Publishing still needs your confirmation code.",
    ],
    steps: ["Install the postrally CLI.", "Run postrally mcp login and sign in in the browser.", "Add PostRally to Cursor's MCP servers."],
  },
  {
    slug: "claude-code",
    name: "Claude Code",
    site: "https://claude.com/product/claude-code",
    title: "Schedule social media posts from Claude Code",
    description: "Use PostRally from Claude Code in your terminal: check analytics, draft posts and schedule them without leaving the repo.",
    points: [
      "One login with postrally mcp login, token kept in the system keychain.",
      "Device-code login works on machines without a browser.",
      "Drafts stay drafts until you confirm a preview.",
    ],
    steps: ["Install the postrally CLI.", "Run postrally mcp login.", "Ask Claude Code to draft or schedule a post."],
  },
  {
    slug: "api",
    name: "REST API",
    title: "Social media scheduling API",
    description: "Every PostRally feature is a REST endpoint with interactive docs: create posts, schedule them per destination, read analytics and receive signed webhooks.",
    points: [
      "Schedule with an absolute time or a local time and timezone.",
      "Bulk create, schedule or cancel up to 100 posts per call.",
      "HMAC-signed webhooks for published, failed, approval and account events.",
      "Failed webhook deliveries are retried.",
    ],
  },
];

export const channels: SeoPage[] = [
  {
    slug: "instagram",
    name: "Instagram",
    site: "https://www.instagram.com",
    title: "Instagram scheduler",
    description: "Schedule Instagram posts, carousels and Reels with PostRally, check them against Instagram's formats before they go out, and see likes, comments, reach and audience demographics.",
    points: ["Carousels, including video slides, and Reels.", "Media checked against Instagram's formats on upload.", "Audience demographics alongside likes and comments.", "Its own caption and media when you post the same idea elsewhere."],
  },
  {
    slug: "x",
    name: "X",
    site: "https://x.com",
    title: "X (Twitter) scheduler",
    description: "Write threads and polls for X, keep each post under 280 characters, and schedule them in your timezone with PostRally.",
    points: ["Threads and polls.", "Each post checked against the 280-character limit.", "Public numbers for competitor accounts on X.", "Best posting time, shown once there are enough posts."],
  },
  {
    slug: "linkedin",
    name: "LinkedIn",
    site: "https://www.linkedin.com",
    title: "LinkedIn post scheduler",
    description: "Schedule LinkedIn posts from your personal profile with PostRally, alongside the same post adjusted for your other networks.",
    points: ["Posts on your personal profile.", "Company pages are not supported yet: they need partner approval from LinkedIn.", "Team approval before anything goes out, if you want it."],
  },
  {
    slug: "youtube",
    name: "YouTube",
    site: "https://www.youtube.com",
    title: "YouTube video scheduler",
    description: "Upload YouTube videos with a title, thumbnail and scheduled release through PostRally, and track views and watch time.",
    points: ["Video, thumbnail and scheduled release time.", "Watch time and views per video.", "Public numbers for competitor channels."],
  },
  {
    slug: "threads",
    name: "Threads",
    site: "https://www.threads.com",
    title: "Threads scheduler",
    description: "Schedule Threads posts and carousels with PostRally, checked against Threads' 500-character limit before they go out.",
    points: ["Text up to 500 characters, counting emoji the way Threads does.", "Carousels of 2 to 20 images or videos."],
  },
  {
    slug: "facebook",
    name: "Facebook",
    site: "https://www.facebook.com",
    title: "Facebook Page post scheduler",
    description: "Schedule posts to your Facebook Pages with PostRally and see how each one did next to your other networks.",
    points: ["Posts to Facebook Pages.", "Page and post stats collected automatically."],
  },
  {
    slug: "pinterest",
    name: "Pinterest",
    site: "https://www.pinterest.com",
    title: "Pinterest pin scheduler",
    description: "Schedule Pinterest pins and video pins with PostRally, with titles and descriptions checked against Pinterest's limits.",
    points: ["Image and video pins.", "Title, description, link and alt text checked against Pinterest's limits.", "Pin stats collected automatically."],
  },
  {
    slug: "tiktok",
    name: "TikTok",
    site: "https://www.tiktok.com",
    title: "TikTok video scheduler",
    description: "Schedule TikTok videos with PostRally and keep their stats next to your other networks.",
    points: ["Video posts with captions.", "Video stats collected automatically."],
  },
  {
    slug: "bluesky",
    name: "Bluesky",
    site: "https://bsky.app",
    title: "Bluesky post scheduler",
    description: "Schedule Bluesky posts with PostRally, checked against the 300-character limit, with up to four images or a video.",
    points: ["Text up to 300 characters.", "Up to four images, or a video."],
  },
  {
    slug: "mastodon",
    name: "Mastodon",
    site: "https://joinmastodon.org",
    title: "Mastodon post scheduler",
    description: "Schedule posts to any Mastodon instance with PostRally. Limits are read from your instance, not guessed.",
    points: ["Works with any instance.", "Character and media limits read from your instance (500 by default)."],
  },
  {
    slug: "telegram",
    name: "Telegram",
    site: "https://telegram.org",
    title: "Telegram channel post scheduler",
    description: "Schedule posts and albums to Telegram channels with PostRally, next to the rest of your networks.",
    points: ["Posts and media albums.", "Scheduled in your timezone like every other network."],
  },
];

// /vs/<slug> comparison pages. Rules: only facts we checked (sources listed on each page, checked on
// the date below); pricing *models* only, never prices, because third-party price lists disagree and
// change; say where the other tool is stronger. PostRally facts come from backend/docs/PROGRESS.md.
export const comparedOn = "15 November 2026";

export type ComparePage = {
  slug: string;
  name: string;
  title: string;
  description: string;
  rows: { label: string; postrally: string; them: string }[];
  theyAreStronger: string[];
  postrallyIsDifferent: string[];
  /** One-paragraph verdict at the end of the page, built only from the lists above. */
  bottomLine: string;
  sources: { label: string; url: string }[];
};

const postrallyNetworks = "Instagram, X, LinkedIn (personal), YouTube, Threads, Facebook Pages, Pinterest, TikTok, Bluesky, Mastodon, Telegram";
const postrallyAi = "Yes: remote MCP server for Claude, ChatGPT and Cursor, plus a CLI and REST API. Publishing needs a confirmation code.";
const postrallyPrice = "Per workspace. Prices not published yet.";

export const comparisons: ComparePage[] = [
  {
    slug: "buffer",
    name: "Buffer",
    title: "PostRally vs Buffer",
    description: "Why PostRally is the Buffer alternative for people who post from Claude or ChatGPT, post to Telegram, and want analytics that don't mix up numbers. Checked side by side, with sources.",
    rows: [
      { label: "Pricing model", postrally: postrallyPrice, them: "Per connected channel, with a free plan for a few channels." },
      { label: "Networks", postrally: postrallyNetworks, them: "Facebook, Instagram, TikTok, YouTube, LinkedIn, Google Business Profile, X, Pinterest, Threads, Bluesky, Mastodon" },
      { label: "Use from Claude, ChatGPT or Cursor", postrally: postrallyAi, them: "Not covered by the sources we checked. See Buffer's site." },
    ],
    theyAreStronger: ["Years in the market and a free plan you can start on today.", "Google Business Profile posting, which PostRally doesn't do.", "Published prices you can plan around."],
    postrallyIsDifferent: ["Telegram channels, which Buffer's network list doesn't include.", "AI assistants can draft and schedule, but never publish without your confirmation code.", "Analytics only adds up numbers that mean the same on every network; views stay per network."],
    bottomLine: "PostRally is the better pick if AI is part of how you work. Claude or ChatGPT drafts and schedules your posts, and nothing goes out until you confirm. You also get Telegram, and analytics that never add up numbers that mean different things on different networks. Buffer still makes sense if Google Business Profile is a must.",
    sources: [
      { label: "Buffer pricing (official, check current prices)", url: "https://buffer.com/pricing" },
      { label: "SocialPilot: Buffer pricing in 2026", url: "https://www.socialpilot.co/insights/buffer-pricing" },
      { label: "NapoleonCat: Buffer per-channel billing", url: "https://napoleoncat.com/blog/buffer-pricing/" },
    ],
  },
  {
    slug: "hootsuite",
    name: "Hootsuite",
    title: "PostRally vs Hootsuite",
    description: "Why growing teams pick PostRally over Hootsuite: one price per workspace instead of per seat, Mastodon and Telegram included, and AI assistants that never publish without you. Checked side by side, with sources.",
    rows: [
      { label: "Pricing model", postrally: postrallyPrice, them: "Per user, paid plans only (trial available)." },
      { label: "Networks", postrally: postrallyNetworks, them: "Instagram, Facebook, X, LinkedIn, TikTok, YouTube, Pinterest, Threads, Bluesky, WhatsApp" },
      { label: "Use from Claude, ChatGPT or Cursor", postrally: postrallyAi, them: "Not covered by the sources we checked. See Hootsuite's site." },
    ],
    theyAreStronger: ["Social listening across many sites, which PostRally doesn't have.", "WhatsApp, which PostRally doesn't post to.", "Enterprise sales, support and compliance programs."],
    postrallyIsDifferent: ["Priced per workspace, not per user, so adding a teammate doesn't change the plan.", "Mastodon and Telegram, which aren't in Hootsuite's listed publishing networks.", "Approval flow where editing an approved post sends it back for review."],
    bottomLine: "PostRally is the better pick for a growing team. You pay per workspace, so a new teammate doesn't raise the bill, and editing an approved post sends it back for review automatically. Mastodon and Telegram are included. Hootsuite still makes sense if you need social listening or WhatsApp.",
    sources: [
      { label: "Hootsuite pricing (official, check current prices)", url: "https://www.hootsuite.com/plans" },
      { label: "SocialPilot: Hootsuite pricing in 2026", url: "https://www.socialpilot.co/?p=715189" },
      { label: "Makerstack: Hootsuite review 2026", url: "https://makerstack.co/reviews/hootsuite-review/" },
    ],
  },
  {
    slug: "later",
    name: "Later",
    title: "PostRally vs Later",
    description: "Why PostRally beats Later if you post beyond Instagram: all 11 networks publish on their own, with no phone reminders, plus an API and webhooks. Checked side by side, with sources.",
    rows: [
      { label: "Pricing model", postrally: postrallyPrice, them: "Per social set, with users and AI credits as add-ons." },
      { label: "Auto-publishing", postrally: "All 11 networks publish automatically.", them: "Instagram, Facebook, TikTok, Pinterest and LinkedIn auto-publish; other networks send a reminder to post by hand." },
      { label: "Use from Claude, ChatGPT or Cursor", postrally: postrallyAi, them: "Not covered by the sources we checked. See Later's site." },
    ],
    theyAreStronger: ["Visual Instagram planning and a long track record with creators.", "Snapchat, which PostRally doesn't support."],
    postrallyIsDifferent: ["Every supported network publishes on its own; no phone reminders.", "Threads, Bluesky, Mastodon and Telegram alongside the big networks.", "A REST API and signed webhooks for your own tools."],
    bottomLine: "PostRally is the better pick if you post to more than Instagram. Every one of its 11 networks publishes on its own, including Threads, Bluesky, Mastodon and Telegram, so you never get a phone reminder to post by hand. Developers get a REST API and signed webhooks. Later still makes sense if Snapchat matters to you.",
    sources: [
      { label: "Later pricing (official, check current prices)", url: "https://later.com/pricing/" },
      { label: "Fastlancer: Later review 2026", url: "https://www.fastlancer.org/en/fastlancer-blog/later-review/" },
      { label: "Postfast: Later vs Buffer 2026", url: "https://postfa.st/blog/later-vs-buffer-feature-and-pricing-comparison" },
    ],
  },
  {
    slug: "postiz",
    name: "Postiz",
    title: "PostRally vs Postiz",
    description: "Why PostRally is the safer Postiz alternative: nothing to host, and an AI assistant can't publish anything until you confirm the preview. Checked side by side, with sources.",
    rows: [
      { label: "Licence and hosting", postrally: "Hosted service.", them: "Open source (AGPL-3.0); self-host it or use their cloud." },
      { label: "Networks", postrally: postrallyNetworks, them: "30+ including Reddit, Discord and Slack" },
      { label: "Use from Claude, ChatGPT or Cursor", postrally: postrallyAi, them: "Yes: MCP support since v1.39.2 (April 2025)." },
    ],
    theyAreStronger: ["Open source: you can read the code and run it on your own server.", "Far more networks, including Reddit, Discord and Slack.", "A large community (40,000+ GitHub stars)."],
    postrallyIsDifferent: ["Publishing from an AI assistant needs a confirmation code from the preview; asking twice never posts twice.", "Analytics that won't add views across networks, because each network counts them differently.", "Nothing to host or update yourself."],
    bottomLine: "PostRally is the better pick if you want to post, not run servers. There's nothing to install or update, and an AI assistant can't publish anything until you confirm the preview. Asking twice never posts twice. Postiz still makes sense if you need to self-host or post to Reddit, Discord or Slack.",
    sources: [
      { label: "Postiz on GitHub (licence, stars)", url: "https://github.com/gitroomhq/postiz-app" },
      { label: "Postiz: OpenClaw page (platform list)", url: "https://postiz.com/openclaw" },
      { label: "Postiz v1.39.3 release notes (MCP)", url: "https://postiz.com/news/postiz-v1-39-3-mcps-auto-posters-plugs" },
    ],
  },
];

// Per-page FAQs (Ribbon guides). Built from the facts above, so a page can't claim more than its own data.
export type Faq = { q: string; a: string };

const pricingFaq: Faq = { q: "How much does PostRally cost?", a: "PostRally is priced per workspace, so adding a teammate doesn't change the plan. Prices aren't published yet." };
const noAutoPublish = "No. You see a preview first, and publishing needs the confirmation code from that preview. The code expires after ten minutes, and asking twice never posts twice.";

export function integrationFaqs(p: SeoPage): Faq[] {
  return [
    p.steps ? { q: `How do I connect ${p.name} to PostRally?`, a: p.steps.join(" ") } : { q: `What can I do with the ${p.name}?`, a: p.points.join(" ") },
    ...(p.slug === "api" ? [] : [{ q: `Can ${p.name} publish a post without asking me?`, a: noAutoPublish }]),
    { q: `Which networks can I post to from ${p.name}?`, a: `All eleven that PostRally supports: ${postrallyNetworks}.` },
    pricingFaq,
  ];
}

export function channelFaqs(p: SeoPage): Faq[] {
  return [
    { q: `Does PostRally publish to ${p.name} on its own?`, a: `Yes. A scheduled ${p.name} post goes out at the time you set, in your timezone. There's no reminder to post it by hand.` },
    { q: `What can I schedule on ${p.name}?`, a: p.points.join(" ") },
    { q: `Can I send the same post to ${p.name} and my other networks?`, a: `Yes. Write it once, then change the caption, media or hashtags for each account. Each version is checked against that network's limits before it goes out.` },
    { q: `Can Claude or ChatGPT post to ${p.name} for me?`, a: `They can draft and schedule it. ${noAutoPublish}` },
    pricingFaq,
  ];
}

export function compareFaqs(p: ComparePage): Faq[] {
  const price = p.rows.find((r) => r.label === "Pricing model");
  return [
    { q: `Why switch from ${p.name} to PostRally?`, a: p.postrallyIsDifferent.join(" ") },
    { q: "Can I use PostRally from Claude or ChatGPT?", a: postrallyAi },
    price ? { q: `How are PostRally and ${p.name} priced?`, a: `PostRally: ${price.postrally} ${p.name}: ${price.them} We list pricing models, not prices, because they change often.` } : pricingFaq,
    { q: `When is ${p.name} the better fit?`, a: p.theyAreStronger.join(" ") },
  ];
}

/** The next `n` pages after `slug` in the same list, wrapping around, so every page gets the same number of inbound links. */
export function related<T extends { slug: string }>(list: readonly T[], slug: string, n = 3): T[] {
  const i = list.findIndex((p) => p.slug === slug);
  return Array.from({ length: Math.min(n, list.length - 1) }, (_, k) => list[(i + 1 + k) % list.length]);
}
