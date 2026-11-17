import "./landing.css";
import Link from "next/link";
import { comparedOn, type ComparePage } from "./seo-pages";
import { SiteHeader } from "./sections/site-header";
import { SiteFooter } from "./sections/site-footer";
import { gutter } from "./components/layout";
import { AssistantDemoSlot } from "./stageshow/assistant-demo-slot";
import { compareDemo } from "./stageshow/assistant-demos";

// /vs/<slug>: a side-by-side table, where the other tool is stronger, where PostRally differs, and the
// sources with the date they were checked. Same white page, header and footer as the rest of the site.
export function ComparePageView({ page }: { page: ComparePage }) {
  return (
    <div className="landing relative flex-1 bg-white font-sans text-ink">
      <SiteHeader solid />
      <main className={`${gutter} pt-36 pb-24 sm:pt-44 sm:pb-32`}>
        <p className="text-sm font-medium text-muted">Compare</p>
        <div className="mt-4 grid items-center gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-6">
          <div>
            <h1 className="font-heading text-heading text-ink">{page.title}</h1>
            <p className="mt-6 max-w-2xl text-lg text-muted">{page.description}</p>
            <Link href="/signup" className="mt-8 inline-flex min-h-12 items-center rounded-full bg-ink px-6 text-sm font-semibold text-white transition-colors hover:bg-ink/85">
              Try PostRally
            </Link>
          </div>
          <AssistantDemoSlot demo={compareDemo(page)} caption={`An assistant asked whether to use PostRally or ${page.name}: it answers from the checked comparison below.`} />
        </div>

        <div className="mt-14 overflow-x-auto rounded-2xl border border-line">
          <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
            <caption className="sr-only">
              {page.title}, checked on {comparedOn}
            </caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="w-1/5 px-5 py-4 font-medium text-muted" />
                <th scope="col" className="px-5 py-4 font-semibold text-ink">
                  PostRally
                </th>
                <th scope="col" className="px-5 py-4 font-semibold text-ink">
                  {page.name}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {page.rows.map((r) => (
                <tr key={r.label} className="align-top">
                  <th scope="row" className="px-5 py-4 font-medium text-ink">
                    {r.label}
                  </th>
                  <td className="px-5 py-4 text-ink">{r.postrally}</td>
                  <td className="px-5 py-4 text-ink">{r.them}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-16 grid gap-12 md:grid-cols-2">
          <section aria-labelledby="stronger">
            <h2 id="stronger" className="text-xl font-semibold text-ink">
              Where {page.name} is stronger
            </h2>
            <ul className="mt-5 divide-y divide-line border-y border-line">
              {page.theyAreStronger.map((p) => (
                <li key={p} className="py-4 text-base text-ink">
                  {p}
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="different">
            <h2 id="different" className="text-xl font-semibold text-ink">
              Where PostRally is different
            </h2>
            <ul className="mt-5 divide-y divide-line border-y border-line">
              {page.postrallyIsDifferent.map((p) => (
                <li key={p} className="py-4 text-base text-ink">
                  {p}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section aria-labelledby="sources" className="mt-16 max-w-2xl">
          <h2 id="sources" className="text-base font-semibold text-ink">
            Sources, checked {comparedOn}
          </h2>
          <p className="mt-2 text-sm text-muted">We list pricing models, not prices, because they change often. Check each company&apos;s own page for current prices.</p>
          <ul className="mt-4 space-y-1">
            {page.sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center text-sm text-ink underline decoration-line underline-offset-4 hover:decoration-ink">
                  {s.label}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        </section>

        <Link href="/#assistants" className="mt-16 inline-flex min-h-12 items-center rounded-full bg-ink px-6 text-sm font-semibold text-white transition-colors hover:bg-ink/85">
          Try PostRally on the home page
        </Link>
      </main>
      <SiteFooter />
    </div>
  );
}
