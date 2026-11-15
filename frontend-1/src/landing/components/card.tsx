import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { PaperScrap, type ScrapTone } from "./paper-scrap";

// Every landing card shares this padding, radius, elevation and text rhythm.
// The visual sits in a fixed-height stage (min-h-96, sized to the tallest visual, optionally on a torn paper scrap) above a fixed
// title (text-xl) and body (text-base), so titles in a row always line up.
type CardProps = {
  title: string;
  body: string;
  visual: ReactNode;
  tone?: ScrapTone;
  className?: string;
};

export function Card({ title, body, visual, tone, className }: CardProps) {
  return (
    <article className={cn("reveal flex min-w-0 flex-col rounded-3xl bg-white p-6 shadow-float sm:p-8", className)}>
      <div className="relative isolate flex min-h-96 items-center justify-center p-6">
        {tone && <PaperScrap tone={tone} className="inset-0 -z-10 -rotate-1" />}
        {visual}
      </div>
      <h3 className="mt-6 text-xl font-semibold tracking-tight text-ink">{title}</h3>
      <p className="mt-2 text-base text-graphite">{body}</p>
    </article>
  );
}
