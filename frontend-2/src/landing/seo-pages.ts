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
