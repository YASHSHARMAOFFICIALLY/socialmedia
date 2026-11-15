// One data file for the search-intent pages linked from the footer (docs/landing-reference.md §4):
// /integrations/<slug> ("schedule posts from Claude") and /channels/<slug> ("Instagram scheduler").
// Facts only from backend/docs/PROGRESS.md and the integration rule files. Compare and guide pages
// come later; they are not linked until they exist.

export type SeoPage = {
  slug: string;
  name: string;
  title: string; // <title> and h1
  description: string; // meta description and intro
  points: string[];
  steps?: string[];
};

export const integrations: SeoPage[] = [
  {
    slug: "claude",
    name: "Claude",
    title: "Schedule social media posts from Claude",
    description: "Connect Distora to Claude and ask in plain words: read your analytics, draft posts for each network and schedule them. Nothing goes out until you confirm.",
    points: [
      "Ask which posts did best, by network, format or posting time.",
      "Draft a post or a thread and keep it as a draft until you're ready.",
      "Schedule across 11 networks in your own timezone.",
      "Publishing needs a confirmation code from the preview. It expires after ten minutes.",
      "Asking twice never posts twice: the code doubles as a replay key.",
    ],
    steps: ["Add Distora as a connector in Claude.", "Sign in through your browser.", "Ask for what you need. Claude shows a preview before anything is published."],
  },
  {
    slug: "chatgpt",
    name: "ChatGPT",
    title: "Schedule social media posts from ChatGPT",
    description: "Use Distora inside ChatGPT to check how your posts did, draft new ones per network and schedule them, with a confirmation step before anything is published.",
    points: [
      "Read analytics across Instagram, X, LinkedIn, YouTube and more.",
      "Draft one post and adjust it per account.",
      "Schedule at a local time; daylight saving is handled.",
      "Every publish shows a preview and needs a code that expires after ten minutes.",
    ],
    steps: ["Add Distora as a connector in ChatGPT.", "Sign in through your browser.", "Ask in plain words and confirm the preview."],
  },
  {
    slug: "cursor",
    name: "Cursor",
    title: "Schedule social media posts from Cursor",
    description: "Run the Distora CLI once and Cursor can draft, check and schedule your posts through Distora's MCP server while you work.",
    points: [
      "Sign in once with distora mcp login.",
      "The token is kept in your system keychain.",
      "Draft release posts next to the code you're shipping.",
      "Publishing still needs your confirmation code.",
    ],
    steps: ["Install the distora CLI.", "Run distora mcp login and sign in in the browser.", "Add Distora to Cursor's MCP servers."],
  },
  {
    slug: "claude-code",
    name: "Claude Code",
    title: "Schedule social media posts from Claude Code",
    description: "Use Distora from Claude Code in your terminal: check analytics, draft posts and schedule them without leaving the repo.",
    points: [
      "One login with distora mcp login, token kept in the system keychain.",
      "Device-code login works on machines without a browser.",
      "Drafts stay drafts until you confirm a preview.",
    ],
    steps: ["Install the distora CLI.", "Run distora mcp login.", "Ask Claude Code to draft or schedule a post."],
  },
  {
    slug: "api",
    name: "REST API",
    title: "Social media scheduling API",
    description: "Every Distora feature is a REST endpoint with interactive docs: create posts, schedule them per destination, read analytics and receive signed webhooks.",
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
    title: "Instagram scheduler",
    description: "Schedule Instagram posts, carousels and Reels with Distora, check them against Instagram's formats before they go out, and see likes, comments, reach and audience demographics.",
    points: ["Carousels, including video slides, and Reels.", "Media checked against Instagram's formats on upload.", "Audience demographics alongside likes and comments.", "Its own caption and media when you post the same idea elsewhere."],
  },
  {
    slug: "x",
    name: "X",
    title: "X (Twitter) scheduler",
    description: "Write threads and polls for X, keep each post under 280 characters, and schedule them in your timezone with Distora.",
    points: ["Threads and polls.", "Each post checked against the 280-character limit.", "Public numbers for competitor accounts on X.", "Best posting time, shown once there are enough posts."],
  },
  {
    slug: "linkedin",
    name: "LinkedIn",
    title: "LinkedIn post scheduler",
    description: "Schedule LinkedIn posts from your personal profile with Distora, alongside the same post adjusted for your other networks.",
    points: ["Posts on your personal profile.", "Company pages are not supported yet: they need partner approval from LinkedIn.", "Team approval before anything goes out, if you want it."],
  },
  {
    slug: "youtube",
    name: "YouTube",
    title: "YouTube video scheduler",
    description: "Upload YouTube videos with a title, thumbnail and scheduled release through Distora, and track views and watch time.",
    points: ["Video, thumbnail and scheduled release time.", "Watch time and views per video.", "Public numbers for competitor channels."],
  },
  {
    slug: "threads",
    name: "Threads",
    title: "Threads scheduler",
    description: "Schedule Threads posts and carousels with Distora, checked against Threads' 500-character limit before they go out.",
    points: ["Text up to 500 characters, counting emoji the way Threads does.", "Carousels of 2 to 20 images or videos."],
  },
  {
    slug: "facebook",
    name: "Facebook",
    title: "Facebook Page post scheduler",
    description: "Schedule posts to your Facebook Pages with Distora and see how each one did next to your other networks.",
    points: ["Posts to Facebook Pages.", "Page and post stats collected automatically."],
  },
  {
    slug: "pinterest",
    name: "Pinterest",
    title: "Pinterest pin scheduler",
    description: "Schedule Pinterest pins and video pins with Distora, with titles and descriptions checked against Pinterest's limits.",
    points: ["Image and video pins.", "Title, description, link and alt text checked against Pinterest's limits.", "Pin stats collected automatically."],
  },
  {
    slug: "tiktok",
    name: "TikTok",
    title: "TikTok video scheduler",
    description: "Schedule TikTok videos with Distora and keep their stats next to your other networks.",
    points: ["Video posts with captions.", "Video stats collected automatically."],
  },
  {
    slug: "bluesky",
    name: "Bluesky",
    title: "Bluesky post scheduler",
    description: "Schedule Bluesky posts with Distora, checked against the 300-character limit, with up to four images or a video.",
    points: ["Text up to 300 characters.", "Up to four images, or a video."],
  },
  {
    slug: "mastodon",
    name: "Mastodon",
    title: "Mastodon post scheduler",
    description: "Schedule posts to any Mastodon instance with Distora. Limits are read from your instance, not guessed.",
    points: ["Works with any instance.", "Character and media limits read from your instance (500 by default)."],
  },
  {
    slug: "telegram",
    name: "Telegram",
    title: "Telegram channel post scheduler",
    description: "Schedule posts and albums to Telegram channels with Distora, next to the rest of your networks.",
    points: ["Posts and media albums.", "Scheduled in your timezone like every other network."],
  },
];

// /vs/<slug> comparison pages. Rules: only facts we checked (sources listed on each page, checked on
// the date below); pricing *models* only, never prices, because third-party price lists disagree and
// change; say where the other tool is stronger. Distora facts come from backend/docs/PROGRESS.md.
export const comparedOn = "15 November 2026";

export type ComparePage = {
  slug: string;
  name: string;
  title: string;
  description: string;
  rows: { label: string; distora: string; them: string }[];
  theyAreStronger: string[];
  distoraIsDifferent: string[];
  sources: { label: string; url: string }[];
};

const distoraNetworks = "Instagram, X, LinkedIn (personal), YouTube, Threads, Facebook Pages, Pinterest, TikTok, Bluesky, Mastodon, Telegram";
const distoraAi = "Yes: remote MCP server for Claude, ChatGPT and Cursor, plus a CLI and REST API. Publishing needs a confirmation code.";
const distoraPrice = "Per workspace. Prices not published yet.";

export const comparisons: ComparePage[] = [
  {
    slug: "buffer",
    name: "Buffer",
    title: "Distora vs Buffer",
    description: "How Distora and Buffer differ on pricing model, networks, AI assistant support and analytics, with the sources we checked.",
    rows: [
      { label: "Pricing model", distora: distoraPrice, them: "Per connected channel, with a free plan for a few channels." },
      { label: "Networks", distora: distoraNetworks, them: "Facebook, Instagram, TikTok, YouTube, LinkedIn, Google Business Profile, X, Pinterest, Threads, Bluesky, Mastodon" },
      { label: "Use from Claude, ChatGPT or Cursor", distora: distoraAi, them: "Not covered by the sources we checked. See Buffer's site." },
    ],
    theyAreStronger: ["Years in the market and a free plan you can start on today.", "Google Business Profile posting, which Distora doesn't do.", "Published prices you can plan around."],
    distoraIsDifferent: ["Telegram channels, which Buffer's network list doesn't include.", "AI assistants can draft and schedule, but never publish without your confirmation code.", "Analytics only adds up numbers that mean the same on every network; views stay per network."],
    sources: [
      { label: "Buffer pricing (official, check current prices)", url: "https://buffer.com/pricing" },
      { label: "SocialPilot: Buffer pricing in 2026", url: "https://www.socialpilot.co/insights/buffer-pricing" },
      { label: "NapoleonCat: Buffer per-channel billing", url: "https://napoleoncat.com/blog/buffer-pricing/" },
    ],
  },
  {
    slug: "hootsuite",
    name: "Hootsuite",
    title: "Distora vs Hootsuite",
    description: "How Distora and Hootsuite differ on pricing model, networks, AI assistant support and team features, with the sources we checked.",
    rows: [
      { label: "Pricing model", distora: distoraPrice, them: "Per user, paid plans only (trial available)." },
      { label: "Networks", distora: distoraNetworks, them: "Instagram, Facebook, X, LinkedIn, TikTok, YouTube, Pinterest, Threads, Bluesky, WhatsApp" },
      { label: "Use from Claude, ChatGPT or Cursor", distora: distoraAi, them: "Not covered by the sources we checked. See Hootsuite's site." },
    ],
    theyAreStronger: ["Social listening across many sites, which Distora doesn't have.", "WhatsApp, which Distora doesn't post to.", "Enterprise sales, support and compliance programs."],
    distoraIsDifferent: ["Priced per workspace, not per user, so adding a teammate doesn't change the plan.", "Mastodon and Telegram, which aren't in Hootsuite's listed publishing networks.", "Approval flow where editing an approved post sends it back for review."],
    sources: [
      { label: "Hootsuite pricing (official, check current prices)", url: "https://www.hootsuite.com/plans" },
      { label: "SocialPilot: Hootsuite pricing in 2026", url: "https://www.socialpilot.co/?p=715189" },
      { label: "Makerstack: Hootsuite review 2026", url: "https://makerstack.co/reviews/hootsuite-review/" },
    ],
  },
  {
    slug: "later",
    name: "Later",
    title: "Distora vs Later",
    description: "How Distora and Later differ on pricing model, networks and auto-publishing, with the sources we checked.",
    rows: [
      { label: "Pricing model", distora: distoraPrice, them: "Per social set, with users and AI credits as add-ons." },
      { label: "Auto-publishing", distora: "All 11 networks publish automatically.", them: "Instagram, Facebook, TikTok, Pinterest and LinkedIn auto-publish; other networks send a reminder to post by hand." },
      { label: "Use from Claude, ChatGPT or Cursor", distora: distoraAi, them: "Not covered by the sources we checked. See Later's site." },
    ],
    theyAreStronger: ["Visual Instagram planning and a long track record with creators.", "Snapchat, which Distora doesn't support."],
    distoraIsDifferent: ["Every supported network publishes on its own; no phone reminders.", "Threads, Bluesky, Mastodon and Telegram alongside the big networks.", "A REST API and signed webhooks for your own tools."],
    sources: [
      { label: "Later pricing (official, check current prices)", url: "https://later.com/pricing/" },
      { label: "Fastlancer: Later review 2026", url: "https://www.fastlancer.org/en/fastlancer-blog/later-review/" },
      { label: "Postfast: Later vs Buffer 2026", url: "https://postfa.st/blog/later-vs-buffer-feature-and-pricing-comparison" },
    ],
  },
  {
    slug: "postiz",
    name: "Postiz",
    title: "Distora vs Postiz",
    description: "How Distora and Postiz differ on licence, hosting, networks and how AI assistants publish, with the sources we checked.",
    rows: [
      { label: "Licence and hosting", distora: "Hosted service.", them: "Open source (AGPL-3.0); self-host it or use their cloud." },
      { label: "Networks", distora: distoraNetworks, them: "30+ including Reddit, Discord and Slack" },
      { label: "Use from Claude, ChatGPT or Cursor", distora: distoraAi, them: "Yes: MCP support since v1.39.2 (April 2025)." },
    ],
    theyAreStronger: ["Open source: you can read the code and run it on your own server.", "Far more networks, including Reddit, Discord and Slack.", "A large community (40,000+ GitHub stars)."],
    distoraIsDifferent: ["Publishing from an AI assistant needs a confirmation code from the preview; asking twice never posts twice.", "Analytics that won't add views across networks, because each network counts them differently.", "Nothing to host or update yourself."],
    sources: [
      { label: "Postiz on GitHub (licence, stars)", url: "https://github.com/gitroomhq/postiz-app" },
      { label: "Postiz: OpenClaw page (platform list)", url: "https://postiz.com/openclaw" },
      { label: "Postiz v1.39.3 release notes (MCP)", url: "https://postiz.com/news/postiz-v1-39-3-mcps-auto-posters-plugs" },
    ],
  },
];
