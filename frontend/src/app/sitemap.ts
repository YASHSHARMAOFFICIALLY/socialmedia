import type { MetadataRoute } from "next";
import { aiPages } from "@/lib/ai-pages";
import { siteUrl } from "@/lib/site";

// Built from the same list as the markdown pages, so the two cannot drift. .md URLs are deliberately left out.
export default function sitemap(): MetadataRoute.Sitemap {
  return aiPages.map((p) => ({ url: p.path === "/" ? siteUrl : `${siteUrl}${p.path}`, priority: p.priority }));
}
