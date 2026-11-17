import { more } from "../content";
import { Section, headingGap } from "../components/layout";

// A plain definition list, Ribbon-style: the smaller features don't need cards.
export function More() {
  return (
    <Section id="more" className="border-t border-line">
      <h2 id="more-title" className="font-heading text-heading font-semibold text-ink">
        {more.title}
      </h2>
      <dl className={`${headingGap} grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-5`}>
        {more.items.map((item) => (
          <div key={item.name} className="border-t border-line pt-4">
            <dt className="text-base font-semibold text-ink">{item.name}</dt>
            <dd className="mt-2 text-base text-muted">{item.text}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}
