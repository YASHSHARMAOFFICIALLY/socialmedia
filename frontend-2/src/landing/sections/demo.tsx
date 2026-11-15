import { demo, platforms } from "../content";
import { Heading, Section } from "../components/layout";

// Ribbon's "What is Ribbon?" block. The composer screen itself hangs from the hero above it,
// so this section only explains it. Standard section padding; no extra offsets needed because
// the hero's own content flow already includes the screen.
export function Demo() {
  return (
    <Section id={demo.id}>
      <div className="grid gap-8 lg:grid-cols-[1fr_1fr] lg:items-end">
        <div>
          <Heading id={`${demo.id}-title`} title={demo.title} accent={demo.titleAccent} />
          <p className="mt-4 max-w-xl text-lg text-muted">{demo.body}</p>
        </div>
        <p className="text-base text-muted lg:text-right">
          <span className="font-medium text-ink">Posts to </span>
          {platforms.join(", ")}.
        </p>
      </div>
    </Section>
  );
}
