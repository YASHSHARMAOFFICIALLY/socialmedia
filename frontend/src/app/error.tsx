"use client";

import Link from "next/link";
import { useEffect } from "react";
import "@/landing/landing.css";
import { SiteHeader } from "@/landing/sections/site-header";
import { gutter } from "@/landing/components/layout";
import { reportError } from "@/lib/report-error";

// Any uncaught error below the root layout. Header stays, so the visitor is never stranded.
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  // Sync with an external system (Clarity) once per error; the no-useEffect escape hatch, same as clarity.tsx.
  useEffect(() => reportError(error), [error]);
  return (
    <div className="landing relative flex-1 bg-white font-sans text-ink">
      <SiteHeader solid />
      <main className={`${gutter} pt-36 pb-24 sm:pt-44 sm:pb-32`}>
        <p className="text-sm font-medium text-muted">Error</p>
        <h1 className="mt-4 font-heading text-heading text-ink">Something broke on our side</h1>
        <p className="mt-6 max-w-xl text-lg text-muted">It&apos;s not you. Try again, and if it keeps happening, go back to the home page. Nothing you scheduled is affected.</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <button type="button" onClick={retry} className="inline-flex min-h-12 items-center rounded-full bg-ink px-6 text-sm font-semibold text-white transition-colors hover:bg-ink/85">
            Try again
          </button>
          <Link href="/" className="inline-flex min-h-12 items-center rounded-full border border-line px-6 text-sm font-semibold text-ink transition-colors hover:border-ink">
            Go to the home page
          </Link>
        </div>
      </main>
    </div>
  );
}
