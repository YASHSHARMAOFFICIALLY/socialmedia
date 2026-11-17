import { demo, platforms } from "../content";
import { Heading, Section } from "../components/layout";
import { BrandGlyph } from "../components/brand-glyph";

// Ribbon's "What is Ribbon?" block. The composer screen hangs from the hero above it, so this
// section explains it in one line and shows where posts go: the eleven networks as small logo
// chips (one list for screen readers, names always written).
export function Demo() {
  return (
    <Section id={demo.id}>
      <div className="grid gap-10 lg:grid-cols-[1fr_1fr] lg:items-end">
        <div>
          <Heading id={`${demo.id}-title`} title={demo.title} accent={demo.titleAccent} />
          <p className="mt-4 max-w-xl text-lg text-muted">{demo.body}</p>
        </div>
        <div>
          <p className="text-sm font-medium text-ink">Posts to</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {platforms.map((name) => (
              <li key={name} className="inline-flex min-h-9 items-center gap-2 rounded-full border border-line bg-white px-3 text-sm text-ink">
                <BrandGlyph name={name} />
                {name}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}
