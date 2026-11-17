import { aiPages } from "@/lib/ai-pages";
import { siteUrl } from "@/lib/site";

// /llms-full.txt: every page's markdown in sitemap order, one file. Small (a few dozen KB), prerendered.
export function GET() {
  const body = aiPages.map((p) => `<!-- ${siteUrl}${p.path} -->\n\n${p.md}`).join("\n\n---\n\n");
  return new Response(body + "\n", { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
