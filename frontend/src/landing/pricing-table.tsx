"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { currency, formatPrice, plans, priceFor, trialDays, type Interval, type Plan, type Region } from "./pricing";

// One pricing card (Ribbon-style) for the home page and /pricing: pick a plan in the segmented control,
// see one big price, what you get, and one button. Pro is picked first. The region starts from the
// visitor's timezone; Dodo still decides the real price from the billing country.

const INDIA_ZONES = ["Asia/Kolkata", "Asia/Calcutta"];

function guessRegion(): Region {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (INDIA_ZONES.includes(zone)) {
    return "india";
  }
  return "intl";
}

const noSubscribe = () => () => {};

function useGuessedRegion(): Region {
  // Server render shows international prices; the browser switches to India right away if it fits.
  return useSyncExternalStore(noSubscribe, guessRegion, () => "intl");
}

function regionName(region: Region): string {
  if (region === "india") {
    return "India";
  }
  return "outside India";
}

function ctaFor(plan: Plan, interval: Interval) {
  if (plan.key === "free") {
    return { href: "/signup", label: "Start free" };
  }
  const query = new URLSearchParams({ plan: plan.key, interval });
  return { href: `/signup?${query}`, label: `Start ${trialDays}-day free trial` };
}

function priceNote(plan: Plan, interval: Interval): string {
  if (plan.key === "free") {
    return "Free for as long as you like";
  }
  if (interval === "year") {
    return `Billed yearly, two months free. ${trialDays} days free first.`;
  }
  return `Billed monthly after a ${trialDays}-day free trial`;
}

function BillingToggle({ value, onChange }: { value: Interval; onChange: (v: Interval) => void }) {
  const options: { value: Interval; label: string }[] = [
    { value: "month", label: "Monthly" },
    { value: "year", label: "Yearly" },
  ];
  return (
    <div role="group" aria-label="Billing period" className="inline-flex rounded-full bg-[#f1f1f3] p-1">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex min-h-9 items-center rounded-full px-3.5 text-sm font-medium",
              "transition-[background-color,color,box-shadow] duration-150",
              selected ? "bg-white text-ink shadow-[0_1px_3px_rgb(17_17_19/0.12)]" : "text-muted hover:text-ink",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Price({ plan, region, interval }: { plan: Plan; region: Region; interval: Interval }) {
  const amount = priceFor(plan, region, interval);
  const price = formatPrice(amount, region);
  const per = interval === "year" ? "/year" : "/month";
  // Yearly: the twelve monthly payments it replaces, struck through (the saving in money).
  const twelveMonths = formatPrice(plan.monthly[region] * 12, region);
  const showStrike = interval === "year" && amount > 0;

  return (
    <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      {/* key: a new price fades in instead of the digits jumping in place. */}
      <span key={price} className="price-in text-5xl font-semibold sm:text-6xl tracking-tight text-ink tabular-nums">
        {price}
      </span>
      {amount > 0 && <span className="text-base text-muted">{per}</span>}
      {showStrike && (
        <s className="text-2xl text-[#8b8b93] tabular-nums">
          <span className="sr-only">instead of </span>
          {twelveMonths}
        </s>
      )}
    </p>
  );
}

export function PricingTable() {
  const guessed = useGuessedRegion();
  const [chosenRegion, setRegion] = useState<Region | null>(null);
  const [interval, setBillingInterval] = useState<Interval>("year");
  const [planKey, setPlanKey] = useState<Plan["key"]>("pro");

  const region = chosenRegion ?? guessed;
  const other: Region = region === "india" ? "intl" : "india";
  const plan = plans.find((p) => p.key === planKey) ?? plans[0];
  const cta = ctaFor(plan, interval);

  return (
    <div className="w-full max-w-xl rounded-[28px] bg-white p-6 shadow-[0_0_0_1px_var(--color-line),0_24px_48px_-24px_rgb(17_17_19/0.18)] sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-3xl font-semibold tracking-tight text-ink">{plan.name}</h3>
          <p className="mt-1 text-base text-muted">{plan.forWho}</p>
        </div>
        <BillingToggle value={interval} onChange={setBillingInterval} />
      </div>

      <Tabs value={planKey} onValueChange={(v) => setPlanKey(v as Plan["key"])} className="mt-6">
        <TabsList aria-label="Plan" className="h-12! w-full rounded-full bg-[#f1f1f3] p-1">
          {plans.map((p) => (
            <TabsTrigger
              key={p.key}
              value={p.key}
              className="h-full rounded-full text-[15px] text-muted data-active:text-ink data-active:shadow-[0_1px_3px_rgb(17_17_19/0.12)]"
            >
              {p.name}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="mt-8" aria-live="polite">
        <Price plan={plan} region={region} interval={interval} />
        <p className="mt-2 text-base text-ink">{priceNote(plan, interval)}</p>
      </div>

      <ul className="mt-6 space-y-3">
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-start gap-3 text-base text-ink">
            <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[#1d7a45] text-white">
              <Check className="size-3" strokeWidth={3} />
            </span>
            {feature}
          </li>
        ))}
      </ul>

      <Link
        href={cta.href}
        className="mt-8 flex min-h-13 items-center justify-center rounded-full bg-ink px-6 text-base font-semibold text-white transition-colors duration-150 hover:bg-ink/85"
      >
        {cta.label}
      </Link>

      <p className="mt-4 text-center text-sm text-muted">
        Per workspace, not per person. Prices in {currency[region].code} for {regionName(region)}.{" "}
        <button
          type="button"
          onClick={() => setRegion(other)}
          className="inline-flex min-h-10 items-center font-medium text-ink underline underline-offset-4 hover:no-underline"
        >
          Show prices for {regionName(other)}
        </button>
      </p>
    </div>
  );
}
