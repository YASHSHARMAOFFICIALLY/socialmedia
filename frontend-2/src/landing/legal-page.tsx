import type { ReactNode } from "react";
import "./landing.css";
import { SiteHeader } from "./sections/site-header";
import { SiteFooter } from "./sections/site-footer";
import { gutter } from "./components/layout";

// Shared shell for /privacy and /terms: same header and footer as home, one readable text column.
export const legalUpdated = "16 November 2026";

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="landing relative flex-1 bg-paper font-sans text-ink">
      <SiteHeader solid />
      <main className={`${gutter} pt-36 pb-24 sm:pt-44 sm:pb-32`}>
        <article className="max-w-2xl text-base leading-relaxed text-ink [&_a]:underline [&_a]:underline-offset-4 [&_h2]:mt-12 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:mt-2 [&_p]:mt-4 [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:pl-5">
          <h1 className="font-heading text-heading text-ink">{title}</h1>
          <p className="text-sm text-muted">Last updated {legalUpdated}</p>
          {children}
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}
