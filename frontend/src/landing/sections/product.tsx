import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { product } from "../content";
import { Heading, Section } from "../components/layout";
import { CalendarScreen } from "../screens/calendar-screen";
import { AnalyticsScreen } from "../screens/analytics-screen";

// Two split blocks, text beside a screen, alternating sides so the section doesn't repeat itself.
export function Product() {
  const { calendar, analytics } = product;
  return (
    <Section id={product.id} className="border-t border-line">
      <h2 id={`${product.id}-title`} className="sr-only">
        Product
      </h2>
      <div className="space-y-24 sm:space-y-32">
        <Split eyebrow={calendar.eyebrow} title={calendar.title} accent={calendar.titleAccent} points={calendar.points}>
          <CalendarScreen />
        </Split>
        <Split flip eyebrow={analytics.eyebrow} title={analytics.title} accent={analytics.titleAccent} points={analytics.points}>
          <AnalyticsScreen />
        </Split>
      </div>
    </Section>
  );
}

type SplitProps = {
  eyebrow: string;
  title: string;
  accent: string;
  points: readonly string[];
  flip?: boolean;
  children: ReactNode;
};

function Split({ eyebrow, title, accent, points, flip = false, children }: SplitProps) {
  return (
    <div className={cn("grid items-center gap-12 lg:gap-16", flip ? "lg:grid-cols-[3fr_2fr]" : "lg:grid-cols-[2fr_3fr]")}>
      <div className={cn(flip && "lg:order-2")}>
        <p className="flex items-center gap-2 text-sm font-medium text-ink">
          <span aria-hidden className="size-2 rounded-full bg-signal" />
          {eyebrow}
        </p>
        <div className="mt-3">
          <Heading title={title} accent={accent} />
        </div>
        <ul className="mt-8 divide-y divide-line border-y border-line">
          {points.map((p) => (
            <li key={p} className="py-4 text-base text-muted">
              {p}
            </li>
          ))}
        </ul>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
