import { footer, nav, productName } from "../content";
import { gutter } from "../components/section";

// One row of links to sections that exist. Compare, guide and integration pages get added
// here when those pages are built (see docs/landing-reference.md, SEO playbook).
export function SiteFooter() {
  return (
    <footer className="border-t border-ash">
      <div className={`${gutter} flex flex-col gap-6 py-12 sm:flex-row sm:items-center sm:justify-between`}>
        <div>
          <p className="font-heading text-2xl text-ink">{productName}</p>
          <p className="mt-2 max-w-sm text-base text-graphite">{footer.tagline}</p>
        </div>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-2">
            {nav.map((item) => (
              <li key={item.href}>
                <a href={item.href} className="inline-flex min-h-11 items-center rounded-lg px-2 text-base text-ink hover:underline hover:underline-offset-4">
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
