"use client";

import { useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import { assistants } from "../content";
import { Heading, Section, headingGap } from "../components/layout";
import { assistantLogos } from "../components/assistant-logos";
import { networkLogos } from "../components/network-logos";

// Pixel-art stickers are heavy (every pixel is a shape). They sit below the fold, so they load
// after the page instead of in its first bundle.
const HeadingStickers = dynamic(() => import("../components/heading-stickers"), { ssr: false });

// "Try it" bento, planned with the stageshow bento rules: one picture made of tiles, not five
// widgets side by side. Every card: a run-in title in page type on top (bold lead, gray sentence),
// the picture under it filling the card. Tiles differ in kind so neighbours contrast:
//
//   lg:  [ assistant: hero UI, 2/3        ][ timezones: big stat     ]
//        [ approvals: one component ][ best time: diagram ][ limits: one component ]
//
// Only the hero has a running motion (the confirm code counts down); the rest answer clicks.
// Colour carries meaning: brand colours name networks and apps, amber = waiting on a person,
// green = done, red = over a limit. State lives in each card (useState + handlers, no effects).
export function Assistants() {
  const a = assistants;
  return (
    <Section id={a.id} className="border-t border-line">
      <div className="relative mx-auto max-w-2xl text-center">
        <HeadingStickers />
        <Heading id={`${a.id}-title`} title={a.title} accent={a.titleAccent} />
        <p className="mt-6 text-lg text-muted">{a.body}</p>
      </div>
      <div className={`${headingGap} grid gap-4 sm:gap-5 md:grid-cols-2 lg:grid-cols-3`}>
        <AssistantCard />
        <ZonesCard />
        <ApprovalsCard />
        <HeatmapCard />
        <LimitsCard />
      </div>
    </Section>
  );
}

// One frame for every tile: same radius, padding and copy position; the variety lives inside.
function Card({ lead, rest, className, children }: { lead: string; rest: string; className?: string; children: ReactNode }) {
  return (
    <article className={cn("bento-tile flex min-h-[26rem] min-w-0 flex-col overflow-hidden rounded-3xl border border-line bg-white p-6 sm:p-7", className)}>
      <h3 className="max-w-md text-[19px] leading-snug font-semibold tracking-tight text-ink">
        {lead} <span className="font-normal text-muted">{rest}</span>
      </h3>
      <div className="mt-6 flex flex-1 flex-col">{children}</div>
    </article>
  );
}

const button = "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-3.5 text-sm font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40";
const primary = `${button} bg-ink text-white hover:bg-ink/85`;
const secondary = `${button} border border-line bg-white text-ink hover:border-ink/30`;
// A picked option (which prompt, which city) is outlined, not filled: solid black means an action.
const selected = `${button} border-[1.5px] border-ink bg-white text-ink`;

function Logo({ name, size = "size-4", fill }: { name: string; size?: string; fill?: string }) {
  const logo = networkLogos[name] ?? assistantLogos[name as keyof typeof assistantLogos];
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={cn("shrink-0", size)}>
      <path d={logo.path} fill={fill ?? (name === "Instagram" ? "#d6249f" : logo.color)} />
    </svg>
  );
}

// 1. Hero UI. Pick your app and a prompt: the tool it calls and the reply. "Schedule" asks for the
// code; confirming twice shows the second call is a replay, not a second post.
const appTint: Record<string, string> = { Claude: "bg-[#fbe3d8]", ChatGPT: "bg-[#d7f0e6]", Cursor: "bg-[#e4e4e7]" };

function AssistantCard() {
  const c = assistants.chat;
  const [app, setApp] = useState(0);
  const [pick, setPick] = useState(2);
  const [confirms, setConfirms] = useState(0);
  const p = c.prompts[pick];
  return (
    <Card className="md:col-span-2" lead={c.lead} rest={c.rest}>
      <div className="flex flex-wrap items-center gap-2">
        {c.apps.map((a, i) => (
          <button
            key={a.name}
            type="button"
            aria-pressed={i === app}
            onClick={() => setApp(i)}
            className={cn(button, "min-h-9 border px-3 text-sm", i === app ? cn("border-ink/15 text-ink", appTint[a.name]) : "border-line bg-white text-muted hover:text-ink")}
          >
            <Logo name={a.name} />
            {a.name}
          </button>
        ))}
      </div>
      <p key={app} className="bento-pop mt-2 text-sm text-muted">
        {c.apps[app].how}
      </p>

      {/* The conversation is the picture: a light panel the reply grows in. */}
      <div key={pick} aria-live="polite" className="bento-pop my-5 flex-1 space-y-3 rounded-2xl border border-line bg-white p-5">
        <p className="ml-auto w-fit max-w-[80%] rounded-2xl rounded-br-md bg-ink px-4 py-2.5 text-[15px] text-white">{p.ask}</p>
        <p className="flex w-fit items-center gap-2 rounded-full bg-white px-3 py-1 font-mono text-xs text-ink shadow-[0_0_0_1px_rgb(17_17_19/0.08)]">
          <span aria-hidden className="size-1.5 rounded-full bg-emerald-600" />
          {p.tool}
        </p>
        <p className="max-w-xl text-[15px] leading-relaxed text-ink">{p.reply}</p>
        {p.tool === "prepare_publish" && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <span className="font-mono text-lg font-semibold tracking-[0.12em] text-amber-900">{c.code}</span>
            <span className="text-sm text-amber-800">
              expires in <span className="bento-countdown font-mono font-semibold tabular-nums" />
            </span>
            <button type="button" onClick={() => setConfirms((n) => n + 1)} className={cn(primary, "ml-auto")}>
              {c.confirm}
            </button>
            {confirms > 0 && (
              <p key={confirms} className="bento-pop w-full rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
                {confirms === 1 ? c.done : c.again}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {c.prompts.map((q, i) => (
          <button
            key={q.tool}
            type="button"
            aria-pressed={i === pick}
            onClick={() => {
              setPick(i);
              setConfirms(0);
            }}
            className={cn(i === pick ? selected : secondary, "h-auto py-2.5 text-left text-[13px] leading-snug sm:justify-start")}
          >
            {q.ask}
          </button>
        ))}
      </div>
    </Card>
  );
}

// 2. Stat. One big time: what Friday 10:00 in Berlin is where your audience lives. The number is
// the picture; the city buttons change it. Offsets are fixed for this example date (content.ts).
function sky(hour: number) {
  if (hour < 6 || hour >= 21) return { name: "Night", cls: "bg-indigo-950 text-white" };
  if (hour < 12) return { name: "Morning", cls: "bg-amber-100 text-amber-900" };
  if (hour < 17) return { name: "Afternoon", cls: "bg-sky-100 text-sky-900" };
  return { name: "Evening", cls: "bg-orange-100 text-orange-900" };
}

function ZonesCard() {
  const z = assistants.zones;
  const [home, ...others] = z.list;
  const [pick, setPick] = useState(1); // Tokyo first: the biggest jump reads best
  const there = others[pick];
  const instant = Date.UTC(2026, 10, 20, 10 - home.offset);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: there.tz, weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(instant);
  const get = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  const time = sky(Number(get("hour")));
  return (
    <Card lead={z.lead} rest={z.rest}>
      <div aria-live="polite" className="flex flex-1 flex-col">
        <p className="text-sm text-muted">Friday 10:00 in {home.city} is</p>
        <p key={pick} className="bento-pop mt-2 text-[88px] leading-none font-semibold tracking-tighter text-ink tabular-nums">
          {get("hour")}:{get("minute")}
        </p>
        <p key={`l${pick}`} className="bento-pop mt-3 flex items-center gap-2 text-base text-ink">
          {get("weekday")} in {there.city}
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", time.cls)}>{time.name}</span>
        </p>
        {/* Each city's day as a 24-hour strip, coloured by time of day, with a mark where the post lands. */}
        <ul aria-hidden className="mt-7 space-y-3.5">
          {z.list.map((o) => {
            const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: o.tz, hour: "2-digit", hourCycle: "h23" }).format(instant));
            const active = o.city === there.city || o.city === home.city;
            return (
              <li key={o.city} className={cn("grid grid-cols-[5.5rem_1fr] items-center gap-3 text-xs transition-opacity duration-300", active ? "opacity-100" : "opacity-45")}>
                <span className="font-medium text-ink">{o.city}</span>
                <span className="relative flex h-3.5 overflow-hidden rounded-full">
                  {Array.from({ length: 24 }, (_, hr) => (
                    <span key={hr} className={cn("flex-1", sky(hr).cls.split(" ")[0])} />
                  ))}
                  <span className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-ink shadow" style={{ left: `${((h + 0.5) / 24) * 100}%` }} />
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="mt-auto grid grid-cols-3 gap-2 pt-6">
        {others.map((o, i) => (
          <button key={o.city} type="button" aria-pressed={i === pick} onClick={() => setPick(i)} className={cn(i === pick ? selected : secondary, "px-2 text-[13px]")}>
            {o.city}
          </button>
        ))}
      </div>
    </Card>
  );
}

// 3. One component: the approval stepper at large size. Approve, then edit after approval.
function ApprovalsCard() {
  const c = assistants.approvals;
  const [state, setState] = useState(0); // 0 needs review, 1 approved, 2 back in review
  const approved = state === 1;
  const s = c.states[state];
  return (
    <Card lead={c.lead} rest={c.rest}>
      {/* The thing being approved, as a small card: the stepper acts on it. */}
      <div className="mb-6 flex items-center gap-3 rounded-xl border border-line px-3.5 py-3">
        <Logo name="X" size="size-5" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">Launch thread</span>
          <span className="block text-xs text-muted">Thread of 4 posts</span>
        </span>
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium transition-colors duration-300", approved ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800")}>{s.pill}</span>
      </div>
      <ol className="flex items-start">
        {c.steps.map((step, i) => {
          const done = i === 0 || approved;
          const waiting = !approved && i === 1;
          return (
            <li key={step} className="flex flex-1 items-start last:flex-none">
              <span className="flex flex-col items-center gap-2">
                <span
                  className={cn(
                    "grid size-12 place-items-center rounded-full border-2 text-base font-semibold transition-colors duration-300",
                    done && "border-emerald-600 bg-emerald-600 text-white",
                    waiting && "border-amber-400 bg-amber-50 text-amber-800",
                    !done && !waiting && "border-line bg-white text-muted",
                  )}
                >
                  {done ? "✓" : i + 1}
                </span>
                <span className="text-sm font-medium text-ink">{step}</span>
              </span>
              {i < c.steps.length - 1 && <span aria-hidden className={cn("mx-2 mt-6 h-0.5 flex-1 rounded-full transition-colors duration-300", approved || i === 0 ? "bg-emerald-600" : "bg-line")} />}
            </li>
          );
        })}
      </ol>
      <p key={state} aria-live="polite" className={cn("bento-pop mt-6 rounded-xl px-4 py-3 text-sm leading-relaxed", approved ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900")}>
        {s.text}
      </p>
      <div className="mt-auto grid grid-cols-2 gap-2 pt-5">
        <button type="button" disabled={approved} onClick={() => setState(1)} className={primary}>
          {c.approve}
        </button>
        <button type="button" disabled={!approved} onClick={() => setState(2)} className={cn(secondary, "px-2 text-[13px]")}>
          {c.edit}
        </button>
      </div>
    </Card>
  );
}

// 4. Diagram: the heatmap filling the tile. Example pattern, peaking on a different day per network.
const heat = [0.07, 0.2, 0.4, 0.68, 1];
function level(d: number, s: number, [pd, ps]: readonly [number, number]) {
  const base = 4 - Math.abs(d - pd) - Math.abs(s - ps);
  return Math.max(0, Math.min(4, base + ((d * 7 + s * 3) % 4 === 0 ? 1 : 0)));
}

function HeatmapCard() {
  const h = assistants.heatmap;
  const [net, setNet] = useState(0);
  const n = h.networks[net];
  const [pd, ps] = n.peak;
  return (
    <Card lead={h.lead} rest={h.rest}>
      <div className="flex gap-1.5">
        {h.networks.map((o, i) => (
          <button
            key={o.name}
            type="button"
            aria-pressed={i === net}
            aria-label={o.name}
            onClick={() => setNet(i)}
            className={cn(button, "min-h-10 border px-3", i === net ? "border-transparent" : "border-line bg-white hover:border-ink/30")}
            style={i === net ? { backgroundColor: o.color } : undefined}
          >
            <Logo name={o.name} fill={i === net ? "#fff" : undefined} />
          </button>
        ))}
        <p key={net} aria-live="polite" className="bento-pop ml-auto self-center text-right text-sm text-ink">
          Best: <span className="font-semibold">{h.days[pd]} {h.slots[ps]}:00</span>
        </p>
      </div>
      <div aria-hidden className="mt-5 grid flex-1 grid-cols-[1.75rem_repeat(7,1fr)] content-start gap-1.5 text-[11px] text-muted">
        <span />
        {h.days.map((d) => (
          <span key={d} className="text-center">
            {d.slice(0, 2)}
          </span>
        ))}
        {h.slots.map((slot, s) => (
          <div key={slot} className="contents">
            <span className="self-center font-mono">{slot}</span>
            {h.days.map((day, d) => (
              <span
                key={day}
                className={cn("aspect-square rounded-md transition-[background-color,opacity] duration-300", d === pd && s === ps && "ring-2 ring-ink ring-offset-2")}
                style={{ backgroundColor: n.color, opacity: heat[level(d, s, n.peak)] }}
              />
            ))}
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted">{h.pill}: example pattern, not real data.</p>
    </Card>
  );
}

// 5. One component: the limits panel. Counts code points; the backend counts graphemes and, for
// Threads, emoji bytes, so this is close but not exact for emoji.
function LimitsCard() {
  const l = assistants.limits;
  const [text, setText] = useState<string>(l.text);
  const n = [...text].length;
  return (
    <Card lead={l.lead} rest={l.rest}>
      <label className="sr-only" htmlFor="bento-limits">
        Post text
      </label>
      <textarea
        id="bento-limits"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        className="w-full resize-none rounded-xl border border-line bg-white p-3.5 text-[15px] leading-relaxed text-ink focus-visible:border-ink"
      />
      <ul className="mt-5 flex-1 space-y-4">
        {l.networks.map((net) => {
          const bad = n > net.max;
          return (
            <li key={net.name}>
              <div className="flex items-center gap-2 text-sm">
                <Logo name={net.name} />
                <span className="font-medium text-ink">{net.name}</span>
                <span className={cn("ml-auto font-mono tabular-nums", bad ? "font-semibold text-red-700" : "text-muted")}>
                  {n} / {net.max}
                </span>
              </div>
              <span aria-hidden className="mt-1.5 block h-2.5 overflow-hidden rounded-full bg-[#f0f0f2]">
                <span
                  className="block h-full rounded-full transition-[width,background-color] duration-200"
                  style={{ width: `${Math.min(100, (n / net.max) * 100)}%`, backgroundColor: bad ? "#dc2626" : networkLogos[net.name].color }}
                />
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
