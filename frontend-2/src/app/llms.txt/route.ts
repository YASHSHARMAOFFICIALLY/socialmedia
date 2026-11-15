import { channels, integrations } from "@/landing/seo-pages";
import { faq, footer, productName } from "@/landing/content";
import { siteUrl } from "@/lib/site";

// /llms.txt: a plain-text map of the site for AI assistants (llmstxt.org format). No request data is
// read, so it is prerendered at build time.

export function GET() {
  const link = (path: string, title: string, note: string) => `- [${title}](${siteUrl}${path}): ${note}`;
  const body = [
    `# ${productName}`,
    "",
    `> ${footer.description}`,
    "",
    "## Use it from",
    ...integrations.map((p) => link(`/integrations/${p.slug}`, p.title, p.description)),
    "",
    "## Networks",
    ...channels.map((p) => link(`/channels/${p.slug}`, p.title, p.description)),
    "",
    "## FAQ",
    ...faq.items.flatMap((i) => [`### ${i.q}`, i.a, ""]),
  ].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
