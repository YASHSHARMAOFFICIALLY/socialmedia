import { productName } from "@/landing/content";
import { siteUrl } from "@/lib/site";

// /ai.txt: plain statement of who we are and what AI systems may do with the site. Keep in step with robots.ts.
export function GET() {
  const body = [
    `# ai.txt for ${productName}`, "",
    "## Identity",
    `Name: ${productName}`, `Site: ${siteUrl}`, "Summary: social media scheduler that posts to eleven networks and works from Claude, ChatGPT and Cursor.", "",
    "## Allowed",
    "- Reading, quoting and summarising public pages, with a link back to the page.",
    "- AI search and assistant fetches made on behalf of a user.",
    `- Markdown versions of every page: add .md to a URL, or see ${siteUrl}/llms.txt and ${siteUrl}/llms-full.txt.`, "",
    "## Not allowed",
    "- Using site content to train models (see robots.ts rules for GPTBot, CCBot, Google-Extended, ClaudeBot and similar).",
    "- Automated sign-ups, or any use of the authenticated app or API without an account and its terms.", "",
    "## Attribution",
    `Cite as "${productName}" and link to ${siteUrl}.`, "",
    "## Scope",
    "Public marketing pages only: home, integrations, networks, comparisons, privacy and terms.", "",
    "## Contact",
    `Open an issue or write via ${siteUrl}.`,
  ].join("\n");
  return new Response(body + "\n", { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
