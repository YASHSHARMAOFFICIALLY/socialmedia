import type { ComparePage } from "../seo-pages";

// The conversation each /integrations/<slug> page plays in its hero. Facts only from PROGRESS.md: a
// preview comes first, publishing needs a confirmation code that expires after ten minutes, drafts stay
// drafts, scheduling uses the user's timezone. No invented numbers; the account names are examples.

export type Demo = {
  title: string; // window title
  mono?: boolean; // terminal-style assistants set their text in the code face
  q: string;
  a: string;
  placeholder: string;
  card: { heading: string; rows: { network: string; text: string }[]; button?: string; done?: string };
};

export const demos: Record<string, Demo | "api"> = {
  claude: {
    title: "Claude",
    q: "Draft a launch post for Friday at 10:00 and schedule it on LinkedIn and X.",
    a: "Here is the preview for both networks, Friday 10:00 in your timezone. Nothing goes out until you confirm with the code below. It expires in ten minutes.",
    placeholder: "Reply to Claude",
    card: { heading: "Preview, code 4821", rows: [{ network: "LinkedIn", text: "Fri 20 Nov, 10:00" }, { network: "X", text: "Thread of 3, Fri 20 Nov, 10:00" }], button: "Confirm and schedule", done: "Scheduled" },
  },
  chatgpt: {
    title: "ChatGPT",
    q: "Which of my posts did best last month, and when should I post next?",
    a: "Instagram carousels led on likes and comments, and your Tuesday mornings beat every other slot. Views stay per network, because each one counts them differently.",
    placeholder: "Message ChatGPT",
    card: { heading: "From your analytics", rows: [{ network: "Instagram", text: "Carousels did best" }, { network: "LinkedIn", text: "Tuesday morning was strongest" }], button: "Draft next week's post", done: "Draft saved" },
  },
  cursor: {
    title: "Cursor",
    mono: true,
    q: "Write a post announcing v2.3 from the changelog.",
    a: "Drafted one version for X and one for Bluesky from the changelog. It stays a draft until you schedule it.",
    placeholder: "Plan, search, build anything",
    card: { heading: "Draft, 2 networks", rows: [{ network: "X", text: "v2.3 is out, three changes" }, { network: "Bluesky", text: "v2.3 is out, with notes" }], button: "Keep as draft", done: "Draft saved" },
  },
  "claude-code": {
    title: "Claude Code",
    mono: true,
    q: "Schedule the release post for Friday at 10:00.",
    a: "Preview ready for Friday 10:00. Publishing needs the confirmation code from the preview, and it expires in ten minutes.",
    placeholder: "Message Claude Code",
    card: { heading: "Preview, code 4821", rows: [{ network: "LinkedIn", text: "Fri 20 Nov, 10:00" }, { network: "Mastodon", text: "Fri 20 Nov, 10:00" }], button: "Confirm and schedule", done: "Scheduled" },
  },
  api: "api",
};

// REST API: the real schedule route (scheduling.routes.ts) and its accepted response.
export const apiLines = [
  "POST /workspaces/{workspaceId}/posts/{postId}/schedule",
  "Authorization: Bearer <api key>",
  "",
  "{",
  '  "localDateTime": "2026-11-20T10:00",',
  '  "timezone": "Europe/Berlin"',
  "}",
  "",
  "202 Accepted",
];

const lower = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

/** /vs/<slug> hero: the question a buyer would ask an assistant, answered from the page's own checked rows. */
export function compareDemo(p: ComparePage): Demo {
  const row = p.rows[0];
  return {
    title: "Claude",
    q: `Should I use PostRally or ${p.name} to schedule my posts?`,
    a: `${p.name} is stronger where ${lower(p.theyAreStronger[0])} PostRally differs here: ${lower(p.postrallyIsDifferent[0])}`,
    placeholder: "Reply to Claude",
    card: { heading: row.label, rows: [{ network: "PostRally", text: row.postrally }, { network: p.name, text: row.them }] },
  };
}
