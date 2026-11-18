import { faq, footer, hero, demo, platforms, productName } from "@/landing/content";
import { channelFaqs, channels, compareFaqs, comparedOn, comparisons, integrationFaqs, integrations, type Faq, type SeoPage } from "@/landing/seo-pages";
import { siteUrl } from "@/lib/site";
import { formatPrice, plans, priceFor, pricingFaqs, trialDays } from "@/landing/pricing";

// Single source for every public page as markdown. /<path>.md, `Accept: text/markdown`, /llms.txt,
// /llms-full.txt and sitemap.xml all read this list, so a page cannot exist in one and not the others.
// Adding a public route = add it here (sitemap and llms files follow).

export type AiPage = { path: string; title: string; description: string; priority: number; section: string; md: string };

const list = (items: readonly string[]) => items.map((i) => `- ${i}`).join("\n");
const steps = (items: readonly string[]) => items.map((s, i) => `${i + 1}. ${s}`).join("\n");

const faqMd = (items: Faq[]) => ["", "## FAQ", ...items.flatMap((i) => ["", `### ${i.q}`, i.a])];

const seoMd = (p: SeoPage, faqs: Faq[]) =>
  [`# ${p.title}`, "", p.description, "", "## What you can do", list(p.points), ...(p.steps ? ["", "## How to connect", steps(p.steps)] : []), ...faqMd(faqs)].join("\n");

const compareMd = (p: (typeof comparisons)[number]) =>
  [
    `# ${p.title}`, "", p.description, "",
    `| | ${productName} | ${p.name} |`, "| --- | --- | --- |",
    ...p.rows.map((r) => `| ${r.label} | ${r.postrally} | ${r.them} |`),
    "", `## Why people pick ${productName} over ${p.name}`, list(p.postrallyIsDifferent),
    "", `## When ${p.name} still fits`, list(p.theyAreStronger),
    "", "## Bottom line", p.bottomLine,
    "", `## Sources, checked ${comparedOn}`, ...p.sources.map((s) => `- [${s.label}](${s.url})`),
    ...faqMd(compareFaqs(p)),
  ].join("\n");

const planMd = (plan: (typeof plans)[number]) => {
  const intl = `${formatPrice(priceFor(plan, "intl", "month"), "intl")}/month`;
  const india = `${formatPrice(priceFor(plan, "india", "month"), "india")}/month in India`;
  const price = plan.monthly.intl === 0 ? "$0" : `${intl} (${india})`;
  return [`### ${plan.name}: ${price}`, plan.forWho, list(plan.features)].join("\n");
};

const pricingMd = [
  `# ${productName} pricing`,
  "",
  `Every paid plan starts with a ${trialDays}-day free trial. Cancel anytime, no questions asked.`,
  "Yearly billing costs 10 months: two months free. Prices are per workspace, not per person.",
  "",
  "## Plans",
  ...plans.flatMap((p) => ["", planMd(p)]),
  "",
  "## FAQ",
  ...pricingFaqs.flatMap((i) => ["", `### ${i.q}`, i.a]),
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
  ...integrations.map((p) => ({ path: `/integrations/${p.slug}`, title: p.title, description: p.description, priority: 0.8, section: "Use it from", md: seoMd(p, integrationFaqs(p)) })),
  ...channels.map((p) => ({ path: `/channels/${p.slug}`, title: p.title, description: p.description, priority: 0.7, section: "Networks", md: seoMd(p, channelFaqs(p)) })),
  ...comparisons.map((p) => ({ path: `/vs/${p.slug}`, title: p.title, description: p.description, priority: 0.7, section: "Compare", md: compareMd(p) })),
  {
    path: "/pricing",
    title: `${productName} pricing`,
    description: `Free plan, then Starter, Pro and Agency. ${trialDays}-day free trial, cancel anytime.`,
    priority: 0.9,
    section: "Product",
    md: pricingMd,
  },
  legal("/privacy", "Privacy Policy", `What ${productName} collects, why, who processes it and how to delete it.`),
  legal("/terms", "Terms of Service", `The terms for using ${productName}.`),
];

export const findAiPage = (path: string) => aiPages.find((p) => p.path === path);

/** `<link rel="alternate" type="text/markdown">` for a page's metadata.alternates.types. */
export const mdAlt = (path: string) => ({ "text/markdown": `${path === "/" ? "/index" : path}.md` });
