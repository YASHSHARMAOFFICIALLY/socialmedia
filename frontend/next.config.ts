import type { NextConfig } from "next";

// Markdown twins (src/app/md): `/x.md` and `Accept: text/markdown` on a public page both serve /md/x.
// Keep these paths in step with lib/ai-pages.ts (sitemap and llms files are generated from it).
const pages = ["/integrations/:slug", "/channels/:slug", "/vs/:slug", "/privacy", "/terms"];
const wantsMarkdown = [{ type: "header" as const, key: "accept", value: ".*text/markdown.*" }];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/index.md", destination: "/md" },
        { source: "/:path+.md", destination: "/md/:path+" },
        { source: "/", has: wantsMarkdown, destination: "/md" },
        ...pages.map((source) => ({ source, has: wantsMarkdown, destination: `/md${source}` })),
      ],
    };
  },
};

export default nextConfig;
