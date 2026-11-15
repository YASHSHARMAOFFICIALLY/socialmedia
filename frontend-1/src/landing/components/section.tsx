import type { ReactNode } from "react";

// The only place that decides spacing between and inside sections, so every section
// gets the same rhythm. Sections never add their own vertical padding or heading gaps.
// Scale: page gutter 4/6, section padding 20/28, heading to content 12/16 (mobile/desktop).
export const gutter = "mx-auto w-full max-w-7xl px-4 sm:px-6";

type SectionProps = {
  id: string;
  title: string;
  body?: string;
  children: ReactNode;
};

export function Section({ id, title, body, children }: SectionProps) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="py-20 sm:py-28">
      <div className={gutter}>
        <div className="mx-auto max-w-2xl text-center">
          <h2 id={`${id}-title`} className="font-heading text-heading text-ink">
            {title}
          </h2>
          {body && <p className="mt-4 text-lg text-graphite">{body}</p>}
        </div>
        <div className="mt-12 sm:mt-16">{children}</div>
      </div>
    </section>
  );
}
