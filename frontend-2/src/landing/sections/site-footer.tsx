import Link from "next/link";
import { askAi, footer, nav, productName } from "../content";
import { channels, comparisons, integrations } from "../seo-pages";
import { gutter } from "../components/layout";
import { LogoMark } from "./site-header";
import { BrandGlyph as Glyph } from "../components/brand-glyph";

// Link-heavy SEO footer (Postiz/Ribbon, light, brand glyph beside each link; docs/landing-reference.md §3):
// brand block and "Ask AI about Distora" left, then columns. Every link opens a real page or section: the AI and network columns go to one
// static page each (seo-pages.ts), which is what makes the footer an internal-link hub.
// A Guides column gets added when those pages exist; no dead links before that.
const linkClass = "inline-flex min-h-9 items-center gap-2.5 text-sm text-muted transition-colors hover:text-ink";

function Column({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <nav aria-label={title} className={className}>
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <ul className="mt-4">{children}</ul>
    </nav>
  );
}

export function SiteFooter() {
  const year = 2026; // ponytail: fixed; static pages would freeze `new Date()` at build time anyway
  return (
    <footer className="border-t border-line bg-white">
      <div className={`${gutter} grid gap-12 py-16 sm:py-20 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1.6fr_1fr_1fr]`}>
        <div className="max-w-sm">
          <Link href="/" className="inline-flex min-h-11 items-center gap-2.5 font-heading text-2xl text-ink">
            <LogoMark />
            {productName}
          </Link>
          <p className="mt-4 text-sm leading-relaxed text-muted">{footer.description}</p>
          <div className="mt-8">
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
          <p className="mt-8 text-sm text-muted">
            Prices are coming soon. Meanwhile, <Link href="/#assistants" className="font-medium text-ink underline decoration-line underline-offset-4 hover:decoration-ink">try every part of it</Link> on this page.
          </p>
        </div>

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

        <Column title="Networks">
          <div className="grid grid-cols-2 gap-x-6">
            {channels.map((p) => (
              <li key={p.slug} className="list-none">
                <Link href={`/channels/${p.slug}`} className={linkClass}>
                  <Glyph name={p.name} />
                  {p.name}
                </Link>
              </li>
            ))}
          </div>
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
      <div className="border-t border-line">
        <div className={`${gutter} flex flex-col gap-2 py-6 text-xs text-muted sm:flex-row sm:justify-between`}>
          <p>
            © {year} {productName}
          </p>
          <p>Posts to {channels.length} networks from one composer, your AI assistant or the API.</p>
        </div>
      </div>
    </footer>
  );
}
