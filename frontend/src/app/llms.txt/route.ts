import { aiPages } from "@/lib/ai-pages";
import { footer, productName } from "@/landing/content";
import { siteUrl } from "@/lib/site";

// /llms.txt (llmstxt.org): a map of the site for AI assistants, built from lib/ai-pages.ts. Links point at
// the markdown twins. Prerendered at build time.
const sections = ["Product", "Use it from", "Networks", "Compare", "Legal"];

export function GET() {
  const body = [
    `# ${productName}`, "", `> ${footer.description}`, "",
    `Every page is also available as markdown (add .md to the URL) and all of them are in ${siteUrl}/llms-full.txt.`, "",
    ...sections.flatMap((s) => [
      `## ${s}`,
      ...aiPages.filter((p) => p.section === s).map((p) => `- [${p.title}](${siteUrl}${p.path === "/" ? "/index" : p.path}.md): ${p.description}`),
      "",
    ]),
  ].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
