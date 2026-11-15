import { nav, productName } from "../content";
import { gutter } from "../components/section";

// Sits on top of the hero's sky background. Only links to sections that exist on this page.
export function SiteHeader() {
  return (
    <header className="absolute inset-x-0 top-0 z-10">
      <div className={`${gutter} flex h-18 items-center justify-between`}>
        <a href="#top" className="inline-flex min-h-11 items-center font-heading text-2xl text-ink">
          {productName}
        </a>
        <nav aria-label="Main">
          <ul className="flex items-center">
            {nav.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  className="inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-medium text-ink hover:underline hover:underline-offset-4 sm:px-3 sm:text-base"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}
