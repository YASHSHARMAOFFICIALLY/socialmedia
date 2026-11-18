import type { ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  CircleCheck,
  Clock,
  FileUp,
  Image as ImageIcon,
  KeyRound,
  ListChecks,
  Mail,
  Megaphone,
  PauseCircle,
  Plug,
  Telescope,
  Terminal,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { more } from "../content";
import { Heading, headingGap, Section } from "../components/layout";
import { Mark } from "../stageshow/mark";
import { CampaignChart } from "./more-chart";

// "Features" as a slice of the PostRally dashboard (Halyard-style): white cards on a grey frame, each card
// one feature with its own data in it. All names and numbers are example data for a placeholder
// workspace; every behaviour shown (limits, roles, retries, events) is real PostRally behaviour.
//
//   lg:  [ campaign: chart, 2/3           ][ up next        ]
//        [ approvals      ][ connections   ][ alert          ]
//        [ webhooks + CLI log, 2/3         ][ team roles     ]
//        [ media checks   ][ bulk import   ][ competitors    ]
//
// The frame is a picture (aria-hidden); screen readers get the feature list instead.
export function More() {
  return (
    <Section id="more" className="border-t border-line">
      <Heading id="more-title" title={more.title} accent={more.titleAccent} className="max-w-3xl" />
      <ul className="sr-only">
        {more.features.map((feature) => (
          <li key={feature}>{feature}</li>
        ))}
      </ul>
      <div
        aria-hidden
        className={cn(
          headingGap,
          "grid gap-3 rounded-3xl bg-[#f4f4f6] p-2 sm:p-3 md:grid-cols-2 lg:grid-cols-3",
        )}
      >
        <Campaign />
        <UpNext />
        <Approvals />
        <Connections />
        <Alert />
        <Webhooks />
        <Team />
        <Media />
        <Bulk />
        <Competitors />
      </div>
    </Section>
  );
}

/* ---------- shared pieces ---------- */

type Tone = "ok" | "warn" | "bad" | "info" | "plain";

const toneClass: Record<Tone, string> = {
  ok: "bg-[#e7f5ec] text-[#1d7a45]",
  warn: "bg-[#fdf3e1] text-[#94540a]",
  bad: "bg-[#fdecea] text-[#b42318]",
  info: "bg-[#eef2fb] text-[#3557b7]",
  plain: "bg-[#f1f1f3] text-[#5b5b62]",
};

function Status({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <Badge className={cn("rounded-md border-0", toneClass[tone])}>{children}</Badge>;
}

type PanelProps = {
  icon: LucideIcon;
  title: string;
  note?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
};

// One card frame for every feature: icon + title, a grey note under it, an optional action on the right.
function Panel({ icon: Icon, title, note, action, className, children }: PanelProps) {
  return (
    <Card className={cn("min-w-0 gap-4 rounded-2xl bg-white py-5 ring-[#e7e7ea]", className)}>
      <CardHeader className="px-5">
        <CardTitle className="flex items-center gap-2 font-sans text-[15px] font-semibold text-ink">
          <Icon className="size-4 text-[#6b6b73]" strokeWidth={2} />
          {title}
        </CardTitle>
        {note && <CardDescription className="text-[13px] text-[#6b6b73]">{note}</CardDescription>}
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col px-5">{children}</CardContent>
    </Card>
  );
}

// A list row: leading thing, two lines of text, something on the right.
function Row({ lead, title, meta, end }: { lead: ReactNode; title: string; meta: string; end?: ReactNode }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      {lead}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{title}</p>
        <p className="truncate text-[13px] text-[#6b6b73]">{meta}</p>
      </div>
      {end}
    </li>
  );
}

function Person({ initials }: { initials: string }) {
  return (
    <Avatar size="sm">
      <AvatarFallback className="bg-[#efeff2] text-[11px] font-semibold text-ink">{initials}</AvatarFallback>
    </Avatar>
  );
}

function FakeButton({ dark = false, children }: { dark?: boolean; children: ReactNode }) {
  const look = dark ? "bg-ink text-white" : "bg-white text-ink ring-1 ring-[#e7e7ea]";
  return (
    <span className={cn("inline-flex h-8 items-center rounded-lg px-3 text-[13px] font-medium", look)}>
      {children}
    </span>
  );
}

/* ---------- cards ---------- */

function Campaign() {
  const stats = [
    { label: "Likes", value: "2,184", change: "+12%" },
    { label: "Comments", value: "316", change: "+4%" },
    { label: "Posts", value: "12", change: null },
  ];
  return (
    <Panel
      icon={Megaphone}
      title="Spring campaign"
      note="12 posts on 5 networks"
      action={
        <div className="flex gap-1.5">
          <FakeButton>CSV</FakeButton>
          <FakeButton>PDF</FakeButton>
        </div>
      }
      className="md:col-span-2"
    >
      <dl className="flex flex-wrap gap-x-10 gap-y-3">
        {stats.map((s) => (
          <div key={s.label}>
            <dt className="text-[13px] text-[#6b6b73]">{s.label}</dt>
            <dd className="mt-0.5 flex items-baseline gap-2">
              <span className="text-2xl font-semibold tracking-tight text-ink tabular-nums">{s.value}</span>
              {s.change && <span className="text-[13px] font-medium text-[#1d7a45]">{s.change}</span>}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-auto pt-4">
        <CampaignChart />
      </div>
    </Panel>
  );
}

const queue = [
  { net: "X", title: "Launch thread", when: "Fri 10:00", tone: "ok", status: "Scheduled" },
  { net: "Instagram", title: "Spring sale carousel", when: "Fri 18:00", tone: "warn", status: "In review" },
  { net: "LinkedIn", title: "We're hiring", when: "Sat 09:00", tone: "bad", status: "Waiting" },
  { net: "TikTok", title: "Behind the scenes", when: "Sun 12:00", tone: "ok", status: "Scheduled" },
  { net: "Telegram", title: "Weekly digest", when: "Mon 08:00", tone: "info", status: "Weekly" },
] as const;

function UpNext() {
  return (
    <Panel icon={Clock} title="Up next" note="This week">
      <ul className="-my-2.5 divide-y divide-[#efeff2]">
        {queue.map((q) => (
          <Row
            key={q.title}
            lead={<Mark name={q.net} className="size-4 shrink-0" />}
            title={q.title}
            meta={`${q.net}, ${q.when}`}
            end={<Status tone={q.tone}>{q.status}</Status>}
          />
        ))}
      </ul>
    </Panel>
  );
}

const reviews = [
  { who: "MK", title: "Spring sale carousel", meta: "Edited after approval", tone: "warn", status: "Review" },
  { who: "SR", title: "Launch thread", meta: "Approved by Priya", tone: "ok", status: "Approved" },
  { who: "LP", title: "Product tour video", meta: "Leo, 2 comments", tone: "bad", status: "Changes" },
  { who: "EC", title: "Customer story", meta: "Elena, not sent yet", tone: "plain", status: "Draft" },
] as const;

function Approvals() {
  return (
    <Panel icon={ListChecks} title="Approvals" note="2 waiting on you">
      <ul className="-my-2.5 divide-y divide-[#efeff2]">
        {reviews.map((r) => (
          <Row
            key={r.title}
            lead={<Person initials={r.who} />}
            title={r.title}
            meta={r.meta}
            end={<Status tone={r.tone}>{r.status}</Status>}
          />
        ))}
      </ul>
    </Panel>
  );
}

// 30 days of daily health per account. "a" marks an amber day, "r" a red one, "." a healthy one.
const health = [
  { net: "Instagram", days: "..............................", note: "Healthy" },
  { net: "X", days: ".........a....................", note: "Healthy" },
  { net: "YouTube", days: "..............................", note: "Healthy" },
  { net: "LinkedIn", days: "......................aaaaaarr", note: "Reconnect" },
];

const dayColor: Record<string, string> = { ".": "bg-[#3fae6a]", a: "bg-[#e9a23b]", r: "bg-[#d92d20]" };

function Connections() {
  return (
    <Panel icon={Plug} title="Connections" note="Last 30 days">
      <ul className="space-y-3.5">
        {health.map((h) => {
          const bad = h.note !== "Healthy";
          return (
            <li key={h.net}>
              <div className="flex items-center gap-2 text-sm">
                <Mark name={h.net} className="size-4 shrink-0" />
                <span className="font-medium text-ink">{h.net}</span>
                <span className={cn("ml-auto text-[13px]", bad ? "font-medium text-[#b42318]" : "text-[#6b6b73]")}>
                  {h.note}
                </span>
              </div>
              <div className="mt-1.5 flex h-5 gap-[2px]">
                {[...h.days].map((d, i) => (
                  <span key={i} className={cn("flex-1 rounded-[2px]", dayColor[d])} />
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

const alertSteps = [
  { icon: KeyRound, text: "LinkedIn sign-in expired", time: "09:42" },
  { icon: Mail, text: "Email and in-app alert sent", time: "09:42" },
  { icon: PauseCircle, text: "2 posts held, none sent late", time: "09:43" },
];

function Alert() {
  return (
    <Panel icon={AlertTriangle} title="Alert" action={<Status tone="bad">Needs you</Status>}>
      <p className="text-base font-semibold text-ink">LinkedIn needs reconnecting</p>
      <p className="text-[13px] text-[#6b6b73]">2 scheduled posts are waiting on it</p>
      <ol className="mt-4 space-y-3">
        {alertSteps.map((s) => (
          <li key={s.text} className="flex items-start gap-2.5 text-sm">
            <s.icon className="mt-0.5 size-4 shrink-0 text-[#6b6b73]" />
            <div>
              <p className="text-ink">{s.text}</p>
              <p className="text-[13px] text-[#6b6b73] tabular-nums">{s.time}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-auto flex gap-2 pt-5">
        <FakeButton dark>Reconnect</FakeButton>
        <FakeButton>View posts</FakeButton>
      </div>
    </Panel>
  );
}

// webhook.service.ts BACKOFF_S: 60s, then 300s, then 1800s...
const log = [
  { time: "10:00:01", text: "post.scheduled", code: "503", rest: "retry in 1 min" },
  { time: "10:01:02", text: "post.scheduled", code: "503", rest: "retry in 5 min" },
  { time: "10:06:03", text: "post.scheduled", code: "200", rest: "delivered" },
  { time: "10:06:40", text: "approval.requested", code: "200", rest: "delivered" },
];

function Webhooks() {
  return (
    <Panel
      icon={Terminal}
      title="Webhooks and CLI"
      note="Signed deliveries to your endpoint"
      action={<Status tone="ok">Signed</Status>}
      className="md:col-span-2"
    >
      <div className="overflow-hidden rounded-xl bg-[#f7f7f8] p-4 font-mono text-[12.5px] leading-6 ring-1 ring-[#efeff2]">
        <p className="truncate text-ink">
          <span className="text-[#8b8b93] select-none">$ </span>postrally mcp login
        </p>
        <p className="truncate text-[#1d7a45]">Signed in. Token saved to macOS Keychain.</p>
        <div className="my-2 h-px bg-[#e7e7ea]" />
        {log.map((l) => {
          const ok = l.code === "200";
          return (
            <p key={l.time} className="flex gap-3 whitespace-nowrap">
              <span className="text-[#8b8b93] tabular-nums">{l.time}</span>
              <span className="min-w-0 truncate text-ink">{l.text}</span>
              <span className={ok ? "text-[#1d7a45]" : "text-[#b42318]"}>{l.code}</span>
              <span className="hidden text-[#6b6b73] sm:inline">{l.rest}</span>
            </p>
          );
        })}
      </div>
    </Panel>
  );
}

const members = [
  { who: "PS", name: "Priya Shah", role: "Owner" },
  { who: "SR", name: "Sam Rivera", role: "Admin" },
  { who: "LP", name: "Leo Park", role: "Editor" },
  { who: "MK", name: "Maya Khan", role: "Analyst" },
  { who: "EC", name: "Elena Cruz", role: "Viewer" },
];

function Team() {
  return (
    <Panel icon={Users} title="Team" note="5 roles per workspace">
      <ul className="-my-1.5 divide-y divide-[#efeff2]">
        {members.map((m) => (
          <li key={m.name} className="flex items-center gap-3 py-1.5 text-sm">
            <Person initials={m.who} />
            <span className="truncate font-medium text-ink">{m.name}</span>
            <span className="ml-auto text-[13px] text-[#6b6b73]">{m.role}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// bluesky.rules.ts: images must be at most 2,000,000 bytes.
const mediaChecks = [
  { net: "Instagram", ok: true, note: "Fits" },
  { net: "LinkedIn", ok: true, note: "Fits" },
  { net: "X", ok: true, note: "Fits" },
  { net: "Threads", ok: true, note: "Fits" },
  { net: "Bluesky", ok: false, note: "Over 2 MB" },
];

function Media() {
  return (
    <Panel icon={ImageIcon} title="Media library" note="launch-photo.jpg, 2.4 MB">
      <ul className="space-y-2.5">
        {mediaChecks.map((c) => (
          <li key={c.net} className="flex items-center gap-2.5 text-sm">
            <Mark name={c.net} className="size-4 shrink-0" />
            <span className="text-ink">{c.net}</span>
            <span className={cn("ml-auto flex items-center gap-1", c.ok ? "text-[#1d7a45]" : "text-[#b42318]")}>
              {c.ok ? <Check className="size-4" /> : <X className="size-4" />}
              {c.note}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// x.rules.ts: 280 characters.
function Bulk() {
  const ready = 38;
  const total = 40;
  return (
    <Panel icon={FileUp} title="Bulk schedule" note="posts.csv, 40 rows">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium text-ink">
          {ready} of {total} ready
        </span>
        <span className="text-[13px] text-[#6b6b73]">2 to fix</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#efeff2]">
        <div className="h-full rounded-full bg-[#3fae6a]" style={{ width: `${(ready / total) * 100}%` }} />
      </div>
      <ul className="mt-4 space-y-2 text-[13px]">
        <li className="flex gap-2 text-[#b42318]">
          <X className="mt-0.5 size-3.5 shrink-0" />
          Row 12: over 280 characters for X
        </li>
        <li className="flex gap-2 text-[#b42318]">
          <X className="mt-0.5 size-3.5 shrink-0" />
          Row 31: no date set
        </li>
        <li className="flex gap-2 text-[#1d7a45]">
          <CircleCheck className="mt-0.5 size-3.5 shrink-0" />
          38 posts ready to schedule
        </li>
      </ul>
    </Panel>
  );
}

const rivals = [
  { net: "X", name: "@northwind", value: "12.4K", label: "followers", change: "+1.2%" },
  { net: "YouTube", name: "Northwind", value: "8,930", label: "subscribers", change: "+0.6%" },
  { net: "X", name: "@contoso", value: "5,210", label: "followers", change: "-0.3%" },
];

function Competitors() {
  return (
    <Panel icon={Telescope} title="Competitors" note="Public numbers, last 30 days">
      <ul className="-my-2.5 divide-y divide-[#efeff2]">
        {rivals.map((r) => (
          <Row
            key={r.name + r.net}
            lead={<Mark name={r.net} className="size-4 shrink-0" />}
            title={r.name}
            meta={`${r.value} ${r.label}`}
            end={
              <span
                className={cn(
                  "text-[13px] font-medium tabular-nums",
                  r.change.startsWith("-") ? "text-[#b42318]" : "text-[#1d7a45]",
                )}
              >
                {r.change}
              </span>
            }
          />
        ))}
      </ul>
    </Panel>
  );
}
