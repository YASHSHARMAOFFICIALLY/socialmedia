import type { Metadata } from "next";
import "@/landing/landing.css";
import { mdAlt } from "@/lib/ai-pages";
import { SiteHeader } from "@/landing/sections/site-header";
import { SiteFooter } from "@/landing/sections/site-footer";
import { gutter } from "@/landing/components/layout";
import { PageFaq } from "@/landing/components/page-extras";
import { PricingTable } from "@/landing/pricing-table";
import { pricingFaqs, trialDays } from "@/landing/pricing";

const title = "PostRally pricing";
const description = `Free plan, then Starter, Pro and Agency, monthly or yearly with two months free. Every paid plan starts with a ${trialDays}-day free trial. Cancel anytime.`;

export const metadata: Metadata = {
  title: `${title}: plans for creators, teams and agencies`,
  description,
  alternates: { canonical: "/pricing", types: mdAlt("/pricing") },
};

export default function Page() {
  return (
    <div className="landing relative flex-1 bg-white font-sans text-ink">
      <SiteHeader solid />
      <main className={`${gutter} pt-36 pb-24 sm:pt-44 sm:pb-32`}>
        <p className="text-sm font-medium text-muted">Pricing</p>
        <h1 className="mt-4 max-w-3xl font-heading text-heading text-ink">
          Start free. Try any paid plan for {trialDays} days.
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-muted">{description}</p>

        <div className="mt-12">
          <h2 className="sr-only">Plans</h2>
          <PricingTable />
        </div>

        <PageFaq items={pricingFaqs} path="/pricing" title={title} />
      </main>
      <SiteFooter />
    </div>
  );
}
