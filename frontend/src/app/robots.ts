import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

// AI search and user-initiated fetchers are allowed; model-training crawlers are blocked (change here and in ai.txt).
const aiSearch = ["OAI-SearchBot", "ChatGPT-User", "Claude-SearchBot", "Claude-User", "PerplexityBot", "Perplexity-User"];
const aiTraining = ["GPTBot", "ClaudeBot", "CCBot", "Google-Extended", "Applebot-Extended", "Bytespider", "Meta-ExternalAgent"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: ["/md/", "/admin"] },
      { userAgent: aiSearch, allow: "/" },
      { userAgent: aiTraining, disallow: "/" },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
