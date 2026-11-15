import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { composer } from "../content";
import { Window } from "../components/window";

// Hero screen: the composer with the X tab open, per-network checks and the schedule panel.
// Character counts are computed from the shown text, not made up.
export function ComposerScreen() {
  const c = composer;
  return (
    <Window
      title="Distora"
      label="The Distora composer: a launch post tuned for X as a four-part thread, checked against LinkedIn, X and Instagram limits, and ready to schedule for Friday 20 November at 10:00 Berlin time pending one review."
    >
      <div className="grid text-[13px] md:grid-cols-[1fr_260px] lg:grid-cols-[200px_1fr_280px]">
        <aside className="hidden border-r border-line p-4 lg:block">
          <p className="font-semibold text-ink">{c.workspace}</p>
          <ul className="mt-4 space-y-1">
            {c.nav.map((item, i) => (
              <li key={item} className={cn("rounded-md px-2 py-1.5", i === 0 ? "bg-paper font-medium text-ink" : "text-muted")}>
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-6 px-2 text-muted">Accounts</p>
          <ul className="mt-2 space-y-1">
            {c.accounts.map((a) => (
              <li key={a} className="flex items-center gap-2 px-2 py-1 text-ink">
                <span className="size-1.5 rounded-full bg-ok" />
                {a}
              </li>
            ))}
          </ul>
        </aside>

        <div className="min-w-0 p-4 sm:p-6">
          <ul className="flex gap-4 overflow-hidden border-b border-line">
            {c.tabs.map((t) => (
              <li
                key={t}
                className={cn("-mb-px shrink-0 border-b-2 pb-2", t === c.activeTab ? "border-signal font-medium text-ink" : "border-transparent text-muted")}
              >
                {t}
              </li>
            ))}
          </ul>
          <ol className="mt-4 space-y-3">
            {c.thread.map((text, i) => (
              <li key={i} className="rounded-xl border border-line p-4">
                <p className="text-sm text-ink">{text}</p>
                <p className="mt-3 flex items-center justify-between text-muted">
                  <span>
                    Post {i + 1} of 4
                  </span>
                  <span className="tabular-nums">
                    {text.length} / {c.limit}
                  </span>
                </p>
              </li>
            ))}
          </ol>
          <div className="mt-3 flex items-center gap-3 rounded-xl border border-dashed border-line p-3 text-muted">
            <span className="h-10 w-14 shrink-0 rounded-md bg-linear-to-br from-signal-soft to-line" />
            launch-photo.jpg, attached to Instagram only
          </div>
        </div>

        <div className="border-t border-line p-4 sm:p-6 md:border-t-0 md:border-l">
          <p className="text-muted">Schedule</p>
          <p className="mt-2 rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink">
            {c.when.date}, {c.when.time}
          </p>
          <p className="mt-1.5 text-muted">{c.when.zone}</p>

          <p className="mt-6 text-muted">Checks</p>
          <ul className="mt-2 space-y-2">
            {c.checks.map((k) => (
              <li key={k.network} className="flex items-center gap-2 text-ink">
                <Check className="size-4 text-ok" />
                <span className="font-medium">{k.network}</span>
                <span className="text-muted">{k.note}</span>
              </li>
            ))}
          </ul>

          <p className="mt-6 flex items-center gap-2 text-ink">
            <span className="size-2 rounded-full bg-signal" />
            {c.review}
          </p>
          <span className="mt-4 flex h-9 items-center justify-center rounded-lg bg-ink text-sm font-medium text-paper">{c.action}</span>
        </div>
      </div>
    </Window>
  );
}
