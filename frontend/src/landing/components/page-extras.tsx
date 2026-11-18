import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { askAi } from "../content";
import { siteUrl } from "@/lib/site";
import type { Faq } from "../seo-pages";
import { BrandGlyph } from "./brand-glyph";
import { JsonLd } from "@/components/json-ld";

// The pieces every footer-linked page shares (Ribbon guide pages, docs/landing-reference.md §2):
// "Ask AI about this page", a bottom-line verdict, related pages, and a per-page FAQ with JSON-LD.
// All server-rendered, no client JS.

/** Icon buttons that open each assistant with this page's markdown twin, plus a link to the markdown itself. */
export function AskAiRow({ path, title, className }: { path: string; title: string; className?: string }) {
  const prompt = `Read ${siteUrl}${path}.md and explain it to me: ${title}. Who is PostRally a good fit for, and what are its limits?`;
  return (
    <div className={className}>
      <p className="text-sm font-medium text-ink">Ask AI about this page</p>
      <ul className="mt-3 flex flex-wrap items-center gap-2">
        {askAi.links.map((l) => (
          <li key={l.name}>
            <a
              href={l.url + encodeURIComponent(prompt)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Ask ${l.name} about this page (opens in a new tab)`}
              title={`Ask ${l.name}`}
              className="inline-flex size-11 items-center justify-center rounded-full border border-line bg-white transition-colors hover:border-ink"
            >
              <BrandGlyph name={l.name} className="size-5" />
            </a>
          </li>
        ))}
        <li aria-hidden className="mx-1 h-6 w-px bg-line" />
        <li>
          <a
            href={`${path}.md`}
            aria-label="Read this page as Markdown"
            title="Markdown"
            className="inline-flex h-11 items-center rounded-xl border border-line bg-white px-3 font-mono text-xs font-semibold text-ink transition-colors hover:border-ink"
          >
            .md
          </a>
        </li>
      </ul>
    </div>
  );
}

export function BottomLine({ text, children }: { text: string; children?: React.ReactNode }) {
  return (
    <section aria-labelledby="bottom-line" className="mt-16 max-w-2xl">
      <h2 id="bottom-line" className="text-xl font-semibold text-ink">
        Bottom line
      </h2>
      <p className="mt-4 text-lg text-ink">{text}</p>
      {children}
    </section>
  );
}

export function RelatedPages({ links }: { links: { href: string; label: string }[] }) {
  return (
    <nav aria-labelledby="related" className="mt-16 max-w-2xl">
      <h2 id="related" className="text-xl font-semibold text-ink">
        Related pages
      </h2>
      <ul className="mt-4 space-y-1">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="inline-flex min-h-11 items-center text-base text-ink underline decoration-line underline-offset-4 hover:decoration-ink">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Ribbon layout: heading, one line and the Ask AI row on the left, questions on the right. First one open. */
export function PageFaq({ items, path, title }: { items: Faq[]; path: string; title: string }) {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((i) => ({ "@type": "Question", name: i.q, acceptedAnswer: { "@type": "Answer", text: i.a } })),
  };
  return (
    <section aria-labelledby="page-faq" className="mt-24 grid gap-12 border-t border-line pt-16 lg:grid-cols-[1fr_2fr] lg:gap-16">
      <div>
        <h2 id="page-faq" className="font-heading text-heading text-ink">
          FAQs
        </h2>
        <p className="mt-6 max-w-sm text-lg text-muted">Short answers for this page. Ask an assistant if yours isn&apos;t here.</p>
        <AskAiRow path={path} title={title} className="mt-8" />
      </div>
      <div className="border-t border-line">
        {items.map((item, i) => (
          <details key={item.q} className="faq-item group border-b border-line" open={i === 0}>
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 py-5 text-lg font-medium text-ink [&::-webkit-details-marker]:hidden">
              {item.q}
              <ChevronDown aria-hidden className="size-5 shrink-0 text-muted transition-transform group-open:rotate-180" />
            </summary>
            <p className="pb-5 text-base text-muted">{item.a}</p>
          </details>
        ))}
      </div>
      <JsonLd data={structuredData} />
    </section>
  );
}
