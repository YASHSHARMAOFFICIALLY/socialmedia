import Link from "next/link";
import "./landing.css";
import { channelFaqs, channels, integrationFaqs, integrations, related, type SeoPage } from "./seo-pages";
import { AskAiRow, PageFaq, RelatedPages } from "./components/page-extras";
import { SiteHeader } from "./sections/site-header";
import { SiteFooter } from "./sections/site-footer";
import { gutter } from "./components/layout";
import { networkLogos } from "./components/network-logos";
import { assistantLogos } from "./components/assistant-logos";
import { AssistantDemoSlot } from "./stageshow/assistant-demo-slot";
import { demos } from "./stageshow/assistant-demos";

// One template for every footer-linked page (integrations and channels): what it is, what you can
// do, how to connect, then the way back to the live demo. Same white page, header and footer as home.
export function SeoPageView({ page, kind }: { page: SeoPage; kind: "Integration" | "Network" }) {
  const demo = kind === "Integration" && page.slug in demos;
  const logo = networkLogos[page.name] ?? assistantLogos[page.name as keyof typeof assistantLogos];
  const integration = kind === "Integration";
  const base = integration ? "/integrations" : "/channels";
  const path = `${base}/${page.slug}`;
  return (
    <div className="landing relative flex-1 bg-paper font-sans text-ink">
      <SiteHeader solid />
      <main className={`${gutter} pt-36 pb-24 sm:pt-44 sm:pb-32`}>
        <p className="flex items-center gap-2 text-sm font-medium text-muted">
          {logo && (
            <svg aria-hidden viewBox="0 0 24 24" className="size-5">
              <path d={logo.path} fill={page.name === "Instagram" ? "#d6249f" : logo.color} />
            </svg>
          )}
          {kind}: {page.name}
        </p>
        <div className={demo ? "mt-4 grid items-center gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-6" : "mt-4"}>
          <div>
            <h1 className="max-w-3xl font-heading text-heading text-ink">{page.title}</h1>
            <p className="mt-6 max-w-2xl text-lg text-muted">{page.description}</p>
            <AskAiRow path={path} title={page.title} className="mt-8" />
            <div className="mt-8 flex flex-wrap gap-3">
              {demo && (
                <Link href="/signup" className="inline-flex min-h-12 items-center rounded-full bg-ink px-6 text-sm font-semibold text-white transition-colors hover:bg-ink/85">
                  Start with {page.name}
                </Link>
              )}
              {page.site && (
                <a href={page.site} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-12 items-center rounded-full border border-line px-6 text-sm font-semibold text-ink transition-colors hover:border-ink">
                  Open {new URL(page.site).hostname.replace("www.", "")}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              )}
            </div>
          </div>
          {demo && <AssistantDemoSlot slug={page.slug} caption={`${page.name} asked to schedule a post: PostRally shows a preview, then the confirm button turns into the result.`} />}
        </div>

        <h2 className="mt-16 text-xl font-semibold text-ink">What you can do</h2>
        <ul className="mt-6 max-w-2xl divide-y divide-line border-y border-line">
          {page.points.map((p) => (
            <li key={p} className="py-4 text-base text-ink">
              {p}
            </li>
          ))}
        </ul>

        {page.steps && (
          <>
            <h2 className="mt-16 text-xl font-semibold text-ink">How to connect</h2>
            <ol className="mt-6 max-w-2xl list-decimal space-y-3 pl-5 text-base text-ink marker:text-muted">
              {page.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </>
        )}

        <Link href="/#assistants" className="mt-16 inline-flex min-h-12 items-center rounded-full bg-ink px-6 text-sm font-semibold text-white transition-colors hover:bg-ink/85">
          Try it on the home page
        </Link>

        <RelatedPages links={related(integration ? integrations : channels, page.slug).map((p) => ({ href: `${base}/${p.slug}`, label: p.title }))} />
        <PageFaq items={integration ? integrationFaqs(page) : channelFaqs(page)} path={path} title={page.title} />
      </main>
      <SiteFooter />
    </div>
  );
}
