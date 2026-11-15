import { Check } from "lucide-react";
import { features } from "../content";
import { Section } from "../components/section";
import { Card } from "../components/card";
import { HandNote, IndexCard, StickyNote } from "../components/craft";
import { PostPreview } from "../components/post-preview";

// Tailoring gets the wide card because it is what you do on every post; the rest are supporting.
export function Features() {
  const f = features;
  return (
    <Section id="features" title={f.title} body={f.body}>
      <div className="grid gap-6 lg:grid-cols-6">
        <Card className="lg:col-span-4" tone="mint" title={f.tailor.title} body={f.tailor.body} visual={<Tailored />} />
        <Card className="lg:col-span-2" title={f.schedule.title} body={f.schedule.body} visual={<Week />} />
        <Card className="lg:col-span-2" title={f.approvals.title} body={f.approvals.body} visual={<Approvals />} />
        <Card className="lg:col-span-2" tone="sky" title={f.analytics.title} body={f.analytics.body} visual={<Metrics />} />
        <Card className="lg:col-span-2" title={f.insights.title} body={f.insights.body} visual={<Insight />} />

        <div className="reveal rounded-3xl border border-ash p-6 sm:p-8 lg:col-span-6">
          <h3 className="text-xl font-semibold tracking-tight text-ink">{f.more.title}</h3>
          <ul className="mt-6 grid list-disc gap-x-6 gap-y-3 pl-5 text-base text-graphite sm:grid-cols-2 lg:grid-cols-4">
            {f.more.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}

const tilts = ["-rotate-2", "rotate-1", "-rotate-1"] as const;

function Tailored() {
  return (
    <div className="grid w-full items-start gap-6 sm:grid-cols-3 sm:gap-4">
      {features.tailor.posts.map((p, i) => (
        <PostPreview key={p.network} {...p} className={`lift ${tilts[i]}`} />
      ))}
    </div>
  );
}

function Week() {
  const s = features.schedule;
  return (
    <IndexCard className="lift w-full max-w-xs rotate-1">
      <p className="font-hand text-2xl text-ink">{s.zone}</p>
      <ol className="mt-2 grid grid-cols-7 gap-1 text-center">
        {s.week.map((d) => (
          <li key={d.day} className="flex flex-col items-center gap-1">
            <span className="text-xs font-medium text-graphite">{d.day}</span>
            <span
              className={`grid h-10 w-full place-items-center rounded-md text-xs font-medium ${d.post ? "bg-periwinkle text-ink" : "bg-linen"}`}
            >
              {d.post ?? ""}
              {d.repeat && <span className="sr-only"> repeats weekly</span>}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-2 font-hand text-xl text-graphite">{s.legend}</p>
    </IndexCard>
  );
}

function Approvals() {
  const tones = ["periwinkle", "marigold", "mint"] as const;
  return (
    <ol className="flex flex-col items-center gap-3">
      {features.approvals.steps.map((s, i) => (
        <li key={s.who}>
          <StickyNote tone={tones[i]} className={`lift flex min-w-40 items-center justify-between gap-3 py-2 text-xl ${i % 2 ? "rotate-2" : "-rotate-2"}`}>
            {s.who}
            {s.done ? <Check aria-label="approved" className="size-5" /> : <span className="text-base text-graphite">next</span>}
          </StickyNote>
        </li>
      ))}
    </ol>
  );
}

function Metrics() {
  return (
    <IndexCard className="lift w-full max-w-xs -rotate-1">
      <ul>
        {features.analytics.rows.map((r) => (
          <li key={r.metric} className="flex h-8 items-end justify-between text-sm">
            <span className="font-medium text-ink">{r.metric}</span>
            <span className="font-hand text-xl text-graphite">{r.note}</span>
          </li>
        ))}
      </ul>
    </IndexCard>
  );
}

// Shows the honest empty state on purpose: no invented "best time" result.
function Insight() {
  const c = features.insights.card;
  return (
    <div className="relative w-full max-w-xs">
      <IndexCard className="lift rotate-1">
        <p className="flex h-8 items-end text-sm font-medium text-ink">{c.heading}</p>
        <p className="flex h-8 items-end text-sm text-graphite">{c.empty}</p>
      </IndexCard>
      <HandNote className="mt-3 justify-center">{c.hint}</HandNote>
    </div>
  );
}
