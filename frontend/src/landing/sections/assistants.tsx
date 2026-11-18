import { cn } from "@/lib/utils";
import { assistants } from "../content";
import { Heading, Section, headingGap } from "../components/layout";
import { assistantLogos } from "../components/assistant-logos";
import { AssistantDemoSlot } from "../stageshow/assistant-demo-slot";
import { landingDemo } from "../stageshow/assistant-demos";

// The AI section: one real flow instead of a grid of widgets. The claim on top; under it the four apps with
// how each one connects (the words a visitor needs to act on) beside the stageshow demo, at about 1:1 (the demo comes first on a phone): the ask, the preview
// with its confirmation code, and the confirm button turning into its own result. The demo is the only
// thing that moves here; it plays once as it scrolls in.
export function Assistants() {
  const a = assistants;
  return (
    <Section id={a.id} className="border-t border-line">
      <div className="grid gap-6 lg:grid-cols-2 lg:items-end lg:gap-16">
        <Heading id={`${a.id}-title`} title={a.title} accent={a.titleAccent} />
        <p className="max-w-xl text-lg text-muted">{a.body}</p>
      </div>
      <div className={`${headingGap} grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:items-end lg:gap-16`}>
        <div className="min-w-0">
          <AssistantDemoSlot
            demo={landingDemo}
            caption="Claude is asked to schedule a launch thread on LinkedIn, X and Instagram. It shows a preview with a confirmation code, and pressing Confirm schedules the three posts."
          />
        </div>
        <AppList />
      </div>
    </Section>
  );
}

// Each app once, with the one step that connects it. Claude Code wears Claude's mark (it has none of its own).
function AppList() {
  const apps = assistants.chat.apps;
  return (
    <ul className="max-w-xl divide-y lg:order-first divide-line border-y border-line">
      {apps.map((app) => (
        <li key={app.name} className="flex items-start gap-4 py-4">
          <AppMark name={app.name} />
          <p className="text-base">
            <span className="font-semibold text-ink">{app.name}.</span>{" "}
            <span className="text-muted">{app.how}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}

function AppMark({ name }: { name: string }) {
  const key = name === "Claude Code" ? "Claude" : name;
  const logo = assistantLogos[key as keyof typeof assistantLogos];
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={cn("mt-0.5 size-5 shrink-0")}>
      <path d={logo.path} fill={logo.color} />
    </svg>
  );
}
