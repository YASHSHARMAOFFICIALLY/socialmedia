import { ChevronDown } from "lucide-react";
import { faq } from "../content";
import { Section } from "../components/layout";
import { JsonLd } from "@/components/json-ld";

// Ribbon layout: title and intro on the left, questions on the right. Native <details>, no client JS.
// JSON-LD lets search engines show these answers directly.
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
    <Section id="faq" className="border-t border-line">
      <div className="grid gap-12 lg:grid-cols-[1fr_2fr] lg:gap-16">
        <div>
          <h2 id="faq-title" className="font-heading text-heading text-ink">
            {faq.title}
          </h2>
          <p className="mt-6 max-w-sm text-lg text-muted">{faq.intro}</p>
        </div>
        <div className="border-t border-line">
          {faq.items.map((item, i) => (
            <details key={item.q} className="faq-item group border-b border-line" open={i === 0}>
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 py-5 text-lg font-medium text-ink [&::-webkit-details-marker]:hidden">
                {item.q}
                <ChevronDown aria-hidden className="size-5 shrink-0 text-muted transition-transform group-open:rotate-180" />
              </summary>
              <p className="pb-5 text-base text-muted">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
      <JsonLd data={structuredData} />
    </Section>
  );
}
