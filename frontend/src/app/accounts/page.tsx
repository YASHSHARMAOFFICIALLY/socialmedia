import type { Metadata } from "next";
import Link from "next/link";
import "@/landing/landing.css";
import { SiteHeader } from "@/landing/sections/site-header";
import { SiteFooter } from "@/landing/sections/site-footer";
import { gutter } from "@/landing/components/layout";

export const metadata: Metadata = { title: "Account connected | PostRally", robots: { index: false } };

// Where the backend sends the browser after a platform OAuth connect (/accounts?connected=<ids>).
// ponytail: there is no signed-in dashboard yet, and connects start from an assistant or the CLI, so this only confirms.
export default function AccountsConnected() {
  return (
    <div className="landing relative flex-1 bg-white font-sans text-ink">
      <SiteHeader solid />
      <main className={`${gutter} pt-36 pb-24 sm:pt-44 sm:pb-32`}>
        <h1 className="font-heading text-heading text-ink">Your account is connected</h1>
        <p className="mt-6 max-w-xl text-lg text-muted">
          Go back to the assistant or terminal where you started. You can close this tab.
        </p>
        <Link href="/" className="mt-8 inline-flex min-h-12 items-center text-base text-ink underline underline-offset-4">
          Back to PostRally
        </Link>
      </main>
      <SiteFooter />
    </div>
  );
}
