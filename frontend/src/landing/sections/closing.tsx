import Link from "next/link";
import { closing } from "../content";
import { Section } from "../components/layout";

// The page's last ask, before the FAQ's answers run out: one line, one honest note about pricing, one button.
export function Closing() {
  return (
    <Section id="start" className="border-t border-line py-20 sm:py-28">
      <div className="mx-auto max-w-2xl text-center">
        <h2 id="start-title" className="font-heading text-heading text-ink">
          {closing.title}
        </h2>
        <p className="mt-5 text-lg text-muted">{closing.body}</p>
        <Link
          href="/signup"
          className="mt-9 inline-flex min-h-13 items-center rounded-full bg-ink px-7 text-base font-semibold text-white transition-colors hover:bg-ink/85"
        >
          {closing.cta}
        </Link>
      </div>
    </Section>
  );
}
