import type { Metadata } from "next";
import Link from "next/link";
import "@/landing/landing.css";
import { SiteHeader } from "@/landing/sections/site-header";
import { SiteFooter } from "@/landing/sections/site-footer";
import { gutter } from "@/landing/components/layout";
import { comparisons, integrations } from "@/landing/seo-pages";

export const metadata: Metadata = { title: "Page not found | PostRally", robots: { index: false } };

// Any unknown URL (and notFound() in the [slug] routes). A dead end becomes a way back to real pages.
export default function NotFound() {
  const links = [
    { href: "/", label: "Home" },
    { href: "/#assistants", label: "Try PostRally" },
    ...integrations.slice(0, 2).map((p) => ({ href: `/integrations/${p.slug}`, label: p.title })),
    ...comparisons.slice(0, 2).map((p) => ({ href: `/vs/${p.slug}`, label: p.title })),
  ];
  return (
    <div className="landing relative flex-1 bg-white font-sans text-ink">
      <SiteHeader solid />
      <main className={`${gutter} pt-36 pb-24 sm:pt-44 sm:pb-32`}>
        <p className="text-sm font-medium text-muted">404</p>
        <h1 className="mt-4 font-heading text-heading text-ink">This page doesn&apos;t exist</h1>
        <p className="mt-6 max-w-xl text-lg text-muted">The link may be old or mistyped. These pages are a good place to start.</p>
        <ul className="mt-8 max-w-xl divide-y divide-line border-y border-line">
          {links.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="flex min-h-12 items-center text-base text-ink hover:underline hover:underline-offset-4">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </main>
      <SiteFooter />
    </div>
  );
}
