import type { MetadataRoute } from "next";
import { channels, comparisons, integrations } from "@/landing/seo-pages";
import { siteUrl } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: siteUrl, priority: 1 },
    ...integrations.map((p) => ({ url: `${siteUrl}/integrations/${p.slug}`, priority: 0.8 })),
    ...channels.map((p) => ({ url: `${siteUrl}/channels/${p.slug}`, priority: 0.7 })),
    ...comparisons.map((p) => ({ url: `${siteUrl}/vs/${p.slug}`, priority: 0.7 })),
    { url: `${siteUrl}/privacy`, priority: 0.3 },
    { url: `${siteUrl}/terms`, priority: 0.3 },
  ];
}
