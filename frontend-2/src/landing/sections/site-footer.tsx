import Link from "next/link";
import { askAi, footer, nav, productName } from "../content";
import { channels, comparisons, integrations } from "../seo-pages";
import { gutter } from "../components/layout";
import { LogoMark } from "./site-header";
import { BrandGlyph as Glyph } from "../components/brand-glyph";

// Link-heavy SEO footer (Postiz/Ribbon, light, brand glyph beside each link; docs/landing-reference.md §3).
// Three bands: brand and "Ask AI about Distora" across the top, five even link columns, then a
// large quiet wordmark that closes the page. Every link opens a real page or section: the AI and network columns go to one
// static page each (seo-pages.ts), which is what makes the footer an internal-link hub.
// A Guides column gets added when those pages exist; no dead links before that.
const linkClass =
  "inline-flex min-h-9 items-center gap-2.5 text-sm text-muted transition-colors hover:text-ink";

function Column({
  title,
  children,
  list,
}: {
  title: string;
  children: React.ReactNode;
  list?: string;
}) {
  return (
    <nav aria-label={title}>
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <ul className={`mt-4 ${list ?? ""}`}>{children}</ul>
    </nav>
  );
}

export function SiteFooter() {
  const year = 2026; // ponytail: fixed; static pages would freeze `new Date()` at build time anyway
  return (
    <footer className="border-t border-line bg-white">
      {/* Top band: who we are, and the one-click way to ask an AI about us. */}
      <div
        className={`${gutter} flex flex-col gap-8 py-14 lg:flex-row lg:items-end lg:justify-between`}
      >
        <div className="max-w-md">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center gap-2.5 font-heading text-2xl text-ink"
          >
            <LogoMark />
            {productName}
          </Link>
          <p className="mt-3 text-base leading-relaxed text-muted">
            {footer.description}
          </p>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-ink">{askAi.title}</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {askAi.links.map((l) => (
              <li key={l.name}>
                <a
                  href={l.url + encodeURIComponent(askAi.prompt)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-10 items-center gap-2 rounded-full border border-line px-3.5 text-sm font-medium text-ink transition-colors hover:border-ink"
                >
                  <Glyph name={l.name} />
                  {l.name}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="border-t border-line">
        <div
          className={`${gutter} grid grid-cols-2 gap-x-8 gap-y-12 py-14 md:grid-cols-3 lg:grid-cols-[1fr_1fr_1.6fr_1fr_1fr]`}
        >
          <Column title={productName}>
            {nav.map((item) => (
              <li key={item.href}>
                <a href={item.href} className={linkClass}>
                  {item.label}
                </a>
              </li>
            ))}
            <li>
              <Link href="/#more" className={linkClass}>
                All features
              </Link>
            </li>
            <li>
              <Link href="/login" className={linkClass}>
                Log in
              </Link>
            </li>
            <li>
              <Link href="/signup" className={linkClass}>
                Sign up
              </Link>
            </li>
          </Column>

          <Column title="Use it from">
            {integrations.map((p) => (
              <li key={p.slug}>
                <Link href={`/integrations/${p.slug}`} className={linkClass}>
                  <Glyph name={p.name === "Claude Code" ? "Claude" : p.name} />
                  {p.name}
                </Link>
              </li>
            ))}
          </Column>

          <Column title="Networks" list="grid grid-cols-2 gap-x-6">
            {channels.map((p) => (
              <li key={p.slug}>
                <Link href={`/channels/${p.slug}`} className={linkClass}>
                  <Glyph name={p.name} />
                  {p.name}
                </Link>
              </li>
            ))}
          </Column>

          <Column title="Compare">
            {comparisons.map((p) => (
              <li key={p.slug}>
                <Link href={`/vs/${p.slug}`} className={linkClass}>
                  vs {p.name}
                </Link>
              </li>
            ))}
          </Column>

          <Column title="For AI and search">
            <li>
              <a href="/llms.txt" className={linkClass}>
                llms.txt
              </a>
            </li>
            <li>
              <a href="/sitemap.xml" className={linkClass}>
                Sitemap
              </a>
            </li>
          </Column>
        </div>
      </div>
      <div className="border-t border-line">
        <div
          className={`${gutter} flex flex-col gap-2 py-6 text-xs text-muted sm:flex-row sm:justify-between`}
        >
          <p>
            © {year} {productName}. Prices are coming soon; meanwhile,{" "}
            <Link
              href="/#assistants"
              className="font-medium text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
            >
              try every part of it
            </Link>
            .
          </p>
          <p>
            Posts to {channels.length} networks from one composer, your AI
            assistant or the API.
          </p>
        </div>
      </div>
      {/* The name, large and quiet, as the page's last line. Decorative: the logo link above names it. */}
      <div aria-hidden className={`${gutter} overflow-hidden`}>
        <p className="translate-y-[18%] text-center font-heading text-[clamp(5rem,22vw,19rem)] leading-[0.8] tracking-tight text-ink/[0.07] select-none">
          {productName}
        </p>
      </div>
    </footer>
  );
}
