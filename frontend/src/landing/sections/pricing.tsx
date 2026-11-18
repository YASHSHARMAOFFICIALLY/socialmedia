import Link from "next/link";
import { pricingSection } from "../content";
import { Heading, Section } from "../components/layout";
import { PricingTable } from "../pricing-table";

// The home page's pricing: the claim on the left, the one pricing card on the right (same card as /pricing,
// which also holds the pricing questions).
export function Pricing() {
  const p = pricingSection;
  return (
    <Section id={p.id} className="border-t border-line">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,36rem)] lg:gap-16">
        <div className="lg:pt-4">
          <Heading id={`${p.id}-title`} title={p.title} accent={p.titleAccent} />
          <p className="mt-6 max-w-md text-lg text-muted">
            {p.body}{" "}
            <Link href="/pricing" className="font-medium text-ink underline underline-offset-4 hover:no-underline">
              {p.link}
            </Link>
          </p>
        </div>
        <PricingTable />
      </div>
    </Section>
  );
}
