// Prices shown on the website. THE ONE PLACE to change what visitors see.
//
// What customers are actually charged is set in the Dodo dashboard (one product per plan and interval,
// USD price + an India "localized price" in INR, 7-day trial). When you change a price there, change it here
// too. The backend's copy (migration 0032_pricing_v2.sql) only feeds reports.
//
// Amounts are whole units (15 = $15, 999 = ₹999). Yearly is always 10 x monthly: two months free.

export type Region = "india" | "intl";
export type Interval = "month" | "year";

export const trialDays = 7;

export const currency: Record<Region, { code: "INR" | "USD"; locale: string; label: string }> = {
  india: { code: "INR", locale: "en-IN", label: "India" },
  intl: { code: "USD", locale: "en-US", label: "Outside India" },
};

export type Plan = {
  key: "free" | "starter" | "pro" | "agency";
  name: string;
  forWho: string;
  monthly: Record<Region, number>;
  features: string[];
  popular?: boolean;
};

export const plans: Plan[] = [
  {
    key: "free",
    name: "Free",
    forWho: "Try it with your own accounts",
    monthly: { india: 0, intl: 0 },
    features: [
      "3 social accounts",
      "1 person",
      "30 posts a month",
      "10 AI posts a month from Claude, ChatGPT or Cursor",
      "30 days of analytics",
    ],
  },
  {
    key: "starter",
    name: "Starter",
    forWho: "One creator or a small business",
    monthly: { india: 999, intl: 15 },
    features: [
      "10 social accounts",
      "3 people",
      "300 posts a month",
      "Unlimited AI posts",
      "90 days of analytics",
    ],
  },
  {
    key: "pro",
    name: "Pro",
    forWho: "A brand or a growing team",
    monthly: { india: 2499, intl: 39 },
    popular: true,
    features: [
      "30 social accounts",
      "10 people",
      "3,000 posts a month",
      "Unlimited AI posts",
      "1 year of analytics",
    ],
  },
  {
    key: "agency",
    name: "Agency",
    forWho: "Agencies posting for clients",
    monthly: { india: 6999, intl: 99 },
    features: [
      "100 social accounts",
      "50 people",
      "Unlimited posts",
      "Unlimited AI posts",
      "1 year of analytics",
    ],
  },
];

/** Pricing questions, shown on /pricing and in its markdown twin. */
export const pricingFaqs = [
  {
    q: "Is there a free trial?",
    a: `Yes. Every paid plan starts with ${trialDays} days free. Cancel before the trial ends and you pay nothing.`,
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes, from your billing settings, no questions asked. You keep the plan until the end of the period you paid for, then the workspace moves to Free.",
  },
  {
    q: "Why is the price different in India?",
    a: "We charge in rupees in India, at a price set for India. Checkout picks the price from your billing country.",
  },
  {
    q: "What is an AI post?",
    a: "A post that Claude, ChatGPT or Cursor publishes or schedules for you after you confirm the preview. Free includes 10 a month. Paid plans have no limit.",
  },
  {
    q: "Do you charge per person?",
    a: "No. You pay per workspace, and each plan includes a number of people. Adding a teammate doesn't change the price.",
  },
  {
    q: "What happens when I reach a limit?",
    a: "PostRally tells you which limit you reached and by how much. Posts that are already scheduled stay scheduled. Upgrade, or wait for next month's posts.",
  },
];

/** What a plan costs for one billing period. */
export function priceFor(plan: Plan, region: Region, interval: Interval): number {
  const monthly = plan.monthly[region];
  if (interval === "year") {
    return monthly * 10;
  }
  return monthly;
}

// Built once per region: the toggle and the plan tabs format prices on every click.
const priceFormatters: Record<Region, Intl.NumberFormat> = {
  india: new Intl.NumberFormat(currency.india.locale, {
    style: "currency",
    currency: currency.india.code,
    maximumFractionDigits: 0,
  }),
  intl: new Intl.NumberFormat(currency.intl.locale, {
    style: "currency",
    currency: currency.intl.code,
    maximumFractionDigits: 0,
  }),
};

/** "₹2,499" or "$39": Indian digit grouping for rupees, no decimals. */
export function formatPrice(amount: number, region: Region): string {
  return priceFormatters[region].format(amount);
}
