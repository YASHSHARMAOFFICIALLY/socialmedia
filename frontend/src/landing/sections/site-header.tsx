import Link from "next/link";
import { nav, productName } from "../content";

// Fixed nav, TapMac/Ribbon style. Over the hero it is a full-width transparent bar with white
// text; after ~160px of scroll it shrinks into a compact white pill (CSS scroll-driven animation in
// landing.css, no JS). Browsers without scroll timelines get the pill from the start.
// Links hide below sm: the logo and the one CTA stay, and every section is reachable by scrolling.
// `solid`: pages without the hero photo start as the compact white pill (landing.css `.is-solid`).
export function SiteHeader({ solid = false }: { solid?: boolean }) {
  return (
    <header className="fixed inset-x-0 top-0 z-40 flex justify-center px-3 pt-3 sm:px-4 sm:pt-4">
      <nav aria-label="Main" className={`site-nav ${solid ? "is-solid" : ""} flex w-full whitespace-nowrap max-w-[1200px] items-center gap-2 rounded-full py-1.5 pr-1.5 pl-2`}>
        <Link href="/" className="inline-flex min-h-11 items-center gap-2.5 rounded-full pr-2 font-heading text-2xl">
          <LogoMark />
          {productName}
        </Link>
        <ul className="mx-auto hidden items-center lg:flex">
          {nav.map((item) => (
            <li key={item.href}>
              <a href={item.href} className="inline-flex min-h-11 items-center rounded-full px-3.5 text-sm font-medium opacity-90 transition-opacity hover:opacity-100">
                {item.label}
              </a>
            </li>
          ))}
        </ul>
        <Link href="/login" className="ml-auto inline-flex min-h-11 items-center rounded-full px-3.5 text-sm font-medium opacity-90 transition-opacity hover:opacity-100 lg:ml-0">
          Log in
        </Link>
        <Link href="/signup" className="site-nav-cta inline-flex min-h-11 shrink-0 items-center rounded-full px-5 text-sm font-semibold transition-transform duration-150 hover:-translate-y-px">
          Get started
        </Link>
      </nav>
    </header>
  );
}

// ponytail: placeholder mark until there is a real logo. An app-icon tile (like Ribbon's and TapMac's)
// with a paper plane: one post sent out. Swap this component when the brand mark exists.
export function LogoMark() {
  return (
    <svg aria-hidden viewBox="0 0 32 32" className="size-8 shrink-0 rounded-[9px] shadow-[0_0_0_1px_rgb(255_255_255/0.25)]">
      <rect width="32" height="32" rx="9" fill="#111113" />
      <path d="M7.5 15.2 24.5 8l-5.6 16.5-3.4-6.6-8-2.7Z" fill="#fff" />
      <path d="m15.5 17.9 9-9.9" stroke="#111113" strokeWidth="1.2" />
    </svg>
  );
}
