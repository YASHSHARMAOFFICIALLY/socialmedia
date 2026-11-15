import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// The only place that decides page width and section spacing, so every section has the same rhythm.
// Scale (mobile/desktop): gutter 16/24px, section padding 96/128px, heading to content 48/64px.
export const gutter = "mx-auto w-full max-w-[1200px] px-4 sm:px-6";
export const headingGap = "mt-12 sm:mt-16";

export function Section({ id, className, children }: { id?: string; className?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className={cn("py-24 sm:py-32", className)}>
      <div className={gutter}>{children}</div>
    </section>
  );
}

// Section headline: Instrument Serif with the accent phrase in italic (Ribbon and TapMac style).
export function Heading({ id, title, accent, className }: { id?: string; title: string; accent: string; className?: string }) {
  return (
    <h2 id={id} className={cn("font-heading text-heading text-ink", className)}>
      {title} <em>{accent}</em>
    </h2>
  );
}
