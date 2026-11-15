import { cn } from "@/lib/utils";
import { product } from "../content";
import { Window } from "../components/window";
import { BrandGlyph } from "../components/brand-glyph";

// State chips: amber = waiting on a person, sky = repeats. Scheduled posts need no chip.
const states = {
  scheduled: null,
  repeats: { text: "Repeats weekly", cls: "bg-sky-50 text-sky-800" },
  review: { text: "Needs review", cls: "bg-amber-50 text-amber-800" },
} as const;

// A week of scheduled posts. On phones the grid scrolls sideways inside the window, never the page.
export function CalendarScreen() {
  const c = product.calendar;
  return (
    <Window
      title="Calendar"
      label="Distora calendar for one week in Berlin time: a launch post on LinkedIn, X and Instagram on Friday at 10:00, a weekly Instagram post repeating on Wednesdays at 18:00, and an X thread on Thursday waiting for review."
    >
      <div className="flex items-center justify-between px-4 py-3 text-[13px] sm:px-6">
        <span className="font-medium text-ink">Week of 16 Nov</span>
        <span className="text-muted">{c.zone}</span>
      </div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[640px] grid-cols-[56px_repeat(7,minmax(0,1fr))] border-t border-line text-[12px]">
          <span />
          {c.days.map((d) => (
            <span key={d} className="border-l border-line px-2 py-2 font-medium text-muted">
              {d}
            </span>
          ))}
          {c.hours.map((h, hi) => (
            <Row key={h} hour={h} hourIndex={hi} />
          ))}
        </div>
      </div>
    </Window>
  );
}

function Row({ hour, hourIndex }: { hour: string; hourIndex: number }) {
  const c = product.calendar;
  return (
    <>
      <span className="border-t border-line px-2 py-2 text-muted tabular-nums">{hour}</span>
      {c.days.map((d, di) => {
        const here = c.posts.filter((p) => p.day === di && p.hour === hourIndex);
        return (
          <div key={d} className="min-h-24 space-y-1 border-t border-l border-line p-1.5">
            {here.map((p) => (
              <div key={p.label} className="rounded-md border border-line bg-white px-1.5 py-1.5 shadow-[0_1px_2px_rgb(17_17_19/0.04)]">
                <BrandGlyph name={p.network} className="size-3.5" />
                <p className="mt-1 line-clamp-2 leading-tight font-medium text-ink">{p.label}</p>
                {states[p.state] && <p className={cn("mt-1 w-fit rounded px-1 py-0.5 text-[11px] font-medium", states[p.state]!.cls)}>{states[p.state]!.text}</p>}
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}
