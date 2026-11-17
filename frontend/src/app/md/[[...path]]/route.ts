import { aiPages, findAiPage } from "@/lib/ai-pages";
import { siteUrl } from "@/lib/site";

// Markdown twin of every public page. Reached via /<path>.md and `Accept: text/markdown` (rewrites in
// next.config.ts); /md/<path> also works. Unknown paths 404.
export function generateStaticParams() {
  return aiPages.map((p) => ({ path: p.path === "/" ? [] : p.path.slice(1).split("/") }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const { path } = await params;
  const route = "/" + (path ?? []).join("/");
  const page = findAiPage(route);
  if (!page) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  return new Response(page.md + "\n", {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      Vary: "Accept",
      "X-Robots-Tag": "noindex", // the HTML page is the canonical, indexed version
      Link: `<${siteUrl}${route === "/" ? "" : route}>; rel="canonical"`,
    },
  });
}
