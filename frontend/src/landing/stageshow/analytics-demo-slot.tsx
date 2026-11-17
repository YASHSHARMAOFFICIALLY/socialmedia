"use client";

import dynamic from "next/dynamic";

// Browser-only (the kit measures the DOM); the wrapper holds the stage's proportions from first paint.
const Demo = dynamic(() => import("./analytics-demo").then((m) => m.AnalyticsDemo), { ssr: false });

export function AnalyticsDemoSlot() {
  return (
    <figure className="m-0">
      <div aria-hidden inert className="aspect-[720/360] max-[639px]:aspect-[358/380]">
        <Demo />
      </div>
      <figcaption className="sr-only">
        PostRally&apos;s analytics for an example account across Instagram, LinkedIn and X: likes and comments add up into a total for all networks, while views get a &quot;Not added up&quot; note because each network counts them differently.
      </figcaption>
    </figure>
  );
}
