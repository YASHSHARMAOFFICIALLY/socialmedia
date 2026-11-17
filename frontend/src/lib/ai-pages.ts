import { faq, footer, hero, demo, platforms, productName } from "@/landing/content";
import { channels, comparedOn, comparisons, integrations, type SeoPage } from "@/landing/seo-pages";
import { siteUrl } from "@/lib/site";

// Single source for every public page as markdown. /<path>.md, `Accept: text/markdown`, /llms.txt,
// /llms-full.txt and sitemap.xml all read this list, so a page cannot exist in one and not the others.
// Adding a public route = add it here (sitemap and llms files follow).

export type AiPage = { path: string; title: string; description: string; priority: number; section: string; md: string };

const list = (items: readonly string[]) => items.map((i) => `- ${i}`).join("\n");
const steps = (items: readonly string[]) => items.map((s, i) => `${i + 1}. ${s}`).join("\n");

const seoMd = (p: SeoPage) =>
  [`# ${p.title}`, "", p.description, "", "## What you can do", list(p.points), ...(p.steps ? ["", "## How to connect", steps(p.steps)] : [])].join("\n");

const compareMd = (p: (typeof comparisons)[number]) =>
  [
    `# ${p.title}`, "", p.description, "",
    `| | ${productName} | ${p.name} |`, "| --- | --- | --- |",
    ...p.rows.map((r) => `| ${r.label} | ${r.postrally} | ${r.them} |`),
    "", `## Where ${p.name} is stronger`, list(p.theyAreStronger),
    "", `## Where ${productName} is different`, list(p.postrallyIsDifferent),
    "", `## Sources, checked ${comparedOn}`, ...p.sources.map((s) => `- [${s.label}](${s.url})`),
  ].join("\n");

const legal = (path: string, title: string, description: string): AiPage => ({
  path, title, description, priority: 0.3, section: "Legal",
  md: `# ${title}\n\n${description}\n\nFull text: ${siteUrl}${path}`,
});

export const aiPages: AiPage[] = [
  {
    path: "/", title: productName, description: footer.description, priority: 1, section: "Product",
    md: [
      `# ${productName}`, "", `> ${footer.description}`, "", hero.body, "",
      `## What is ${productName}?`, demo.body, "", "## Networks", list(platforms), "",
      "## FAQ", ...faq.items.flatMap((i) => [`### ${i.q}`, i.a, ""]),
    ].join("\n"),
  },
  ...integrations.map((p) => ({ path: `/integrations/${p.slug}`, title: p.title, description: p.description, priority: 0.8, section: "Use it from", md: seoMd(p) })),
  ...channels.map((p) => ({ path: `/channels/${p.slug}`, title: p.title, description: p.description, priority: 0.7, section: "Networks", md: seoMd(p) })),
  ...comparisons.map((p) => ({ path: `/vs/${p.slug}`, title: p.title, description: p.description, priority: 0.7, section: "Compare", md: compareMd(p) })),
  legal("/privacy", "Privacy Policy", `What ${productName} collects, why, who processes it and how to delete it.`),
  legal("/terms", "Terms of Service", `The terms for using ${productName}.`),
];

export const findAiPage = (path: string) => aiPages.find((p) => p.path === path);

/** `<link rel="alternate" type="text/markdown">` for a page's metadata.alternates.types. */
export const mdAlt = (path: string) => ({ "text/markdown": `${path === "/" ? "/index" : path}.md` });
