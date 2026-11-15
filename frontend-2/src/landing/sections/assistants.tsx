"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { assistants } from "../content";
import { Heading, Section, headingGap } from "../components/layout";
import { assistantLogos } from "../components/assistant-logos";
import { networkLogos } from "../components/network-logos";
import dynamic from "next/dynamic";

// Pixel-art stickers are heavy (every pixel is a shape). They sit below the fold, so they load
// after the page instead of in its first bundle.
const HeadingStickers = dynamic(() => import("../components/heading-stickers"), { ssr: false });

// Bento of five small working widgets, each card in its own soft colour on the pure white page. Each card: label + coloured status pill on top,
// a live widget in the middle, actions at the bottom. Colour carries meaning, never decoration:
// network and app brand colours identify them, amber = waiting on someone, green = done,
// red = over a limit, the sky chips = time of day.
//
//   lg:  [ assistant (wide)        ][ approvals ]
//        [ heatmap ][ limits        ][ timezones ]
//
// State lives in each card (useState + event handlers, no effects). Motion: cards rise in as they
// scroll in, new content pops in, the confirm code counts down (landing.css, reduced-motion safe).
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
        <ApprovalsCard />
        <HeatmapCard />
        <LimitsCard />
        <ZonesCard />
      </div>
    </Section>
  );
}

const tones = {
  neutral: "border-ink/10 bg-white text-muted",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  green: "border-emerald-200 bg-emerald-50 text-emerald-800",
  blue: "border-sky-200 bg-sky-50 text-sky-800",
} as const;
type Tone = keyof typeof tones;

// Cards are pure white (#ffffff) like the reference bento; colour lives in the widgets inside.
const fills = {
  peach: "border-line bg-white",
  amber: "border-line bg-white",
  pink: "border-line bg-white",
  sky: "border-line bg-white",
  lavender: "border-line bg-white",
} as const;

function Card({ label, pill, tone = "neutral", fill, className, children }: { label: string; pill: ReactNode; tone?: Tone; fill: keyof typeof fills; className?: string; children: ReactNode }) {
  return (
    <article className={cn("bento-tile flex min-h-80 min-w-0 flex-col rounded-2xl border p-5 shadow-[0_1px_2px_rgb(17_17_19/0.05)] transition-shadow duration-300 hover:shadow-[0_10px_30px_-10px_rgb(17_17_19/0.14)] sm:p-6", fills[fill], className)}>
      <header className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink">{label}</h3>
        <span className={cn("shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors", tones[tone])}>{pill}</span>
      </header>
      {children}
    </article>
  );
}

const button = "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-3.5 text-sm font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40";
const primary = `${button} bg-ink text-white hover:bg-ink/85`;
const secondary = `${button} border border-ink/10 bg-white text-ink hover:bg-white/70`;

function Logo({ name, size = "size-4", fill }: { name: string; size?: string; fill?: string }) {
  const logo = networkLogos[name] ?? assistantLogos[name as keyof typeof assistantLogos];
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={cn("shrink-0", size)}>
      <path d={logo.path} fill={fill ?? (name === "Instagram" ? "#d6249f" : logo.color)} />
    </svg>
  );
}

// 1. Pick your app, pick a prompt: the tool it calls and the reply. "Schedule" asks for the code;
// confirming twice shows the second call is a replay, not a second post.
const appTint: Record<string, string> = { Claude: "bg-[#fbe3d8]", ChatGPT: "bg-[#d7f0e6]", Cursor: "bg-[#e4e4e7]" };

function AssistantCard() {
  const c = assistants.chat;
  const [app, setApp] = useState(0);
  const [pick, setPick] = useState(2);
  const [confirms, setConfirms] = useState(0);
  const p = c.prompts[pick];
  return (
    <Card className="md:col-span-2" fill="peach" label={c.label} pill="MCP server" tone="blue">
      <div className="mt-5 flex flex-wrap items-center gap-2">
        {c.apps.map((a, i) => (
          <button
            key={a.name}
            type="button"
            aria-pressed={i === app}
            onClick={() => setApp(i)}
            className={cn(button, "min-h-9 border px-3 text-xs", i === app ? cn("border-ink/15 text-ink", appTint[a.name]) : "border-ink/10 bg-white text-muted hover:text-ink")}
          >
            <Logo name={a.name} size="size-3.5" />
            {a.name}
          </button>
        ))}
        <p key={app} className="bento-pop text-xs text-muted sm:ml-2">
          {c.apps[app].how}
        </p>
      </div>

      <div key={pick} aria-live="polite" className="bento-pop my-5 flex-1 space-y-3 rounded-2xl bg-white p-4 shadow-[0_0_0_1px_rgb(17_17_19/0.06)]">
        <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-ink px-4 py-2.5 text-sm text-white">{p.ask}</p>
        <p className="flex w-fit items-center gap-2 rounded-full bg-white px-3 py-1 font-mono text-xs text-ink shadow-[0_0_0_1px_rgb(17_17_19/0.08)]">
          <span aria-hidden className="size-1.5 rounded-full bg-emerald-600" />
          {p.tool}
        </p>
        <p className="max-w-xl text-sm leading-relaxed text-ink">{p.reply}</p>
        {p.tool === "prepare_publish" && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <span className="font-mono text-base font-semibold tracking-[0.12em] text-amber-900">{c.code}</span>
            <span className="text-xs text-amber-800">
              expires in <span className="bento-countdown font-mono font-semibold tabular-nums" />
            </span>
            <button type="button" onClick={() => setConfirms((n) => n + 1)} className={cn(primary, "ml-auto min-h-9")}>
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
            className={cn(i === pick ? primary : secondary, "h-auto py-2.5 text-left text-xs leading-snug sm:justify-start")}
          >
            {q.ask}
          </button>
        ))}
      </div>
    </Card>
  );
}

// 2. Approve, then edit after approval: the post goes back for review.
function ApprovalsCard() {
  const c = assistants.approvals;
  const [state, setState] = useState(0); // 0 needs review, 1 approved, 2 back in review
  const approved = state === 1;
  const s = c.states[state];
  return (
    <Card fill="amber" label={c.label} pill={s.pill} tone={approved ? "green" : "amber"}>
      <ol className="mt-6 flex items-center">
        {c.steps.map((step, i) => {
          const done = i === 0 || approved;
          const waiting = !approved && i === 1;
          return (
            <li key={step} className="flex flex-1 items-center last:flex-none">
              <span className="flex flex-col items-center gap-1.5">
                <span
                  className={cn(
                    "grid size-8 place-items-center rounded-full border text-xs font-semibold transition-colors duration-300",
                    done && "border-emerald-600 bg-emerald-600 text-white",
                    waiting && "border-amber-400 bg-amber-50 text-amber-800",
                    !done && !waiting && "border-ink/15 bg-white text-muted",
                  )}
                >
                  {done ? "✓" : i + 1}
                </span>
                <span className="text-xs font-medium text-ink">{step}</span>
              </span>
              {i < c.steps.length - 1 && <span aria-hidden className={cn("mx-2 mb-5 h-0.5 flex-1 rounded-full transition-colors duration-300", approved || i === 0 ? "bg-emerald-600" : "bg-ink/15")} />}
            </li>
          );
        })}
      </ol>
      <p key={state} aria-live="polite" className="bento-pop mt-6 flex-1 text-sm leading-relaxed text-ink">
        {s.text}
      </p>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <button type="button" disabled={approved} onClick={() => setState(1)} className={primary}>
          {c.approve}
        </button>
        <button type="button" disabled={!approved} onClick={() => setState(2)} className={cn(secondary, "px-2 text-xs")}>
          {c.edit}
        </button>
      </div>
    </Card>
  );
}

// 3. When each network's audience reacts most. Example pattern, peaking on a different day per network.
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
    <Card fill="pink" label={h.label} pill={h.pill}>
      <div className="mt-5 grid grid-cols-3 gap-1.5">
        {h.networks.map((o, i) => (
          <button
            key={o.name}
            type="button"
            aria-pressed={i === net}
            onClick={() => setNet(i)}
            className={cn(button, "min-h-9 border px-2 text-xs", i === net ? "border-transparent text-white" : "border-ink/10 bg-white text-ink hover:bg-white/70")}
            style={i === net ? { backgroundColor: o.color } : undefined}
          >
            <Logo name={o.name} size="size-3.5" fill={i === net ? "#fff" : undefined} />
            {o.name}
          </button>
        ))}
      </div>
      <div aria-hidden className="mt-5 grid grid-cols-[1.5rem_repeat(7,1fr)] gap-1 text-[10px] text-muted">
        <span />
        {h.days.map((d) => (
          <span key={d} className="text-center">
            {d.slice(0, 1)}
          </span>
        ))}
        {h.slots.map((slot, s) => (
          <div key={slot} className="contents">
            <span className="self-center font-mono">{slot}</span>
            {h.days.map((day, d) => (
              <span
                key={day}
                title={`${day} ${slot}:00`}
                className={cn("aspect-square rounded-[5px] transition-[background-color,opacity] duration-300", d === pd && s === ps && "ring-2 ring-ink ring-offset-1")}
                style={{ backgroundColor: n.color, opacity: heat[level(d, s, n.peak)] }}
              />
            ))}
          </div>
        ))}
      </div>
      <p key={net} aria-live="polite" className="bento-pop mt-4 flex-1 text-sm text-ink">
        Best on {n.name}: <span className="font-semibold">{h.days[pd]} {h.slots[ps]}:00</span>
      </p>
      <p className="mt-2 text-xs text-muted">{h.note}</p>
    </Card>
  );
}

// 4. Type and watch each network's limit in its own colour. Counts code points; the backend counts
// graphemes and, for Threads, emoji bytes, so this is close but not exact for emoji.
function LimitsCard() {
  const l = assistants.limits;
  const [text, setText] = useState<string>(l.text);
  const n = [...text].length;
  const over = l.networks.filter((net) => n > net.max).length;
  return (
    <Card fill="sky" label={l.label} pill={over ? `${over} over` : l.pill} tone={over ? "amber" : "neutral"}>
      <label className="sr-only" htmlFor="bento-limits">
        Post text
      </label>
      <textarea
        id="bento-limits"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        className="mt-5 w-full resize-none rounded-xl border border-ink/10 bg-white p-3 text-sm text-ink focus-visible:border-ink"
      />
      <ul className="mt-4 flex-1 space-y-3">
        {l.networks.map((net) => {
          const bad = n > net.max;
          return (
            <li key={net.name} className="grid grid-cols-[1rem_4.5rem_1fr_4.5rem] items-center gap-2 text-xs">
              <Logo name={net.name} />
              <span className="font-medium text-ink">{net.name}</span>
              <span aria-hidden className="h-2 overflow-hidden rounded-full bg-white shadow-[inset_0_0_0_1px_rgb(17_17_19/0.06)]">
                <span
                  className="block h-full rounded-full transition-[width,background-color] duration-200"
                  style={{ width: `${Math.min(100, (n / net.max) * 100)}%`, backgroundColor: bad ? "#dc2626" : networkLogos[net.name].color }}
                />
              </span>
              <span className={cn("text-right font-mono tabular-nums", bad ? "font-semibold text-red-700" : "text-muted")}>
                {n}/{net.max}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// 5. Pick the city you schedule from: the same 10:00 everywhere else, coloured by time of day.
function sky(hour: number) {
  if (hour < 6 || hour >= 21) return { name: "Night", cls: "bg-indigo-950 text-white" };
  if (hour < 12) return { name: "Morning", cls: "bg-amber-100 text-amber-900" };
  if (hour < 17) return { name: "Afternoon", cls: "bg-sky-100 text-sky-900" };
  return { name: "Evening", cls: "bg-orange-100 text-orange-900" };
}

function ZonesCard() {
  const z = assistants.zones;
  const [home, setHome] = useState(0);
  const instant = Date.UTC(2026, 10, 20, 10 - z.list[home].offset);
  return (
    <Card fill="lavender" label={z.label} pill={z.pill} tone="blue">
      <p className="mt-5 text-xs text-muted">Pick where you schedule from. The post goes out Fri 10:00 there.</p>
      <ul className="mt-3 flex-1 space-y-1.5">
        {z.list.map((o, i) => {
          const parts = new Intl.DateTimeFormat("en-GB", { timeZone: o.tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(instant);
          const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
          const time = sky(Number(get("hour")));
          return (
            <li key={o.city}>
              <button
                type="button"
                aria-pressed={i === home}
                onClick={() => setHome(i)}
                className={cn("flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors duration-150", i === home ? "border-ink bg-white" : "border-ink/10 bg-white/60 hover:bg-white")}
              >
                <span className="flex-1 text-sm font-medium text-ink">{o.city}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", time.cls)}>{time.name}</span>
                <span className="w-20 text-right font-mono text-sm text-ink tabular-nums">
                  {get("weekday")} {get("hour")}:{get("minute")}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
