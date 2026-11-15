import { ChevronDown } from "lucide-react";
import { faq } from "../content";
import { Section } from "../components/section";

// Native <details>: keyboard and screen-reader support for free, no client JS.
// The JSON-LD lets search engines show these answers directly.
const structuredData = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faq.items.map((item) => ({
    "@type": "Question",
    name: item.q,
    acceptedAnswer: { "@type": "Answer", text: item.a },
  })),
};

export function Faq() {
  return (
    <Section id="faq" title={faq.title} body={faq.intro}>
      <div className="mx-auto max-w-3xl border-t border-ash">
        {faq.items.map((item, i) => (
          <details key={item.q} className="faq-item group border-b border-ash" open={i === 0}>
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 py-5 text-lg font-medium text-ink [&::-webkit-details-marker]:hidden">
              {item.q}
              <ChevronDown aria-hidden className="size-5 shrink-0 text-graphite transition-transform group-open:rotate-180" />
            </summary>
            <p className="pb-5 text-base text-graphite">{item.a}</p>
          </details>
        ))}
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
    </Section>
  );
}
