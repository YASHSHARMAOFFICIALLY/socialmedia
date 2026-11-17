import { demo } from "../content";
import { Heading, Section } from "../components/layout";

// Ribbon's "What is Ribbon?" block. The composer screen hangs from the hero above it, so this
// section only says what it is: a heading and one sentence. The eleven networks are already in the
// hero, so they are not listed a second time here.
export function Demo() {
  return (
    <Section id={demo.id} className="py-16 sm:py-24">
      <div className="grid gap-6 lg:grid-cols-2 lg:items-end lg:gap-16">
        <Heading id={`${demo.id}-title`} title={demo.title} accent={demo.titleAccent} />
        <p className="max-w-xl text-lg text-muted">{demo.body}</p>
      </div>
    </Section>
  );
}
