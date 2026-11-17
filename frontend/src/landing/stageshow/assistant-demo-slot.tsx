"use client";

import dynamic from "next/dynamic";
import type { Demo as DemoData } from "./assistant-demos";

// The stageshow runs in the browser only (it measures the DOM and drives its own clock), so it loads
// client-side. The wrapper holds the stage's proportions from the first paint, so the page doesn't shift.
const Demo = dynamic(() => import("./assistant-demo").then((m) => m.AssistantDemo), { ssr: false });

export function AssistantDemoSlot({ slug, demo, caption }: { slug?: string; demo?: DemoData; caption: string }) {
  const ratio = slug === "api" ? "aspect-[760/300] max-[639px]:aspect-[358/300]" : "aspect-[760/440] max-[639px]:aspect-[358/560]";
  return (
    <figure className="m-0">
      {/* A picture of the product, not a control: hidden from assistive tech and out of the tab order. */}
      <div aria-hidden inert className={ratio}>
        <Demo slug={slug} demo={demo} />
      </div>
      <figcaption className="sr-only">{caption}</figcaption>
    </figure>
  );
}
