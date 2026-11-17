"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useSWRConfig } from "swr";
import { gutter } from "@/landing/components/layout";
import { LogoMark } from "@/landing/sections/site-header";
import { cn } from "@/lib/utils";
import { TrafficCharts } from "./charts";
import { fmtAge, fmtBytes, fmtInt, fmtMs, fmtPct, fmtUsd, fmtWhen } from "./format";
import { setToken, tokenWasRejected, useOps, useOpsToken, type AuditPage, type ErrorPage, type Metrics, type OpsError, type Overview } from "./ops-api";

// Owner-only Health & Activity. Every number comes from the backend's /admin/ops/* (Postgres tables
// and catalog); anything the backend does not record is labelled "not tracked yet", never estimated.
// Status colours always travel with a word (OK, Degraded, Down), never colour alone.

const TONE = { ok: "text-ok", warn: "text-[#a15c07]", bad: "text-[#b42318]", none: "text-ink" } as const;
type Tone = keyof typeof TONE;
const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
const btn = cn("inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-white px-4 text-sm font-medium text-ink hover:bg-secondary disabled:opacity-50", focus);

export function OpsDashboard() {
  const token = useOpsToken();
  if (token === undefined) return <Shell><p className="py-24 text-muted">Loading…</p></Shell>;
  if (!token) return <TokenGate />;
  return <Dashboard token={token} />;
}

function Shell({ children, bar }: { children: ReactNode; bar?: ReactNode }) {
  return (
    <main className="min-h-dvh bg-white pb-24">
      <div className={cn(gutter, "flex min-h-16 items-center gap-3 border-b border-line")}>
        <span className="inline-flex items-center gap-2.5 font-heading text-2xl text-ink"><LogoMark />PostRally</span>
        <span className="text-sm text-muted">Owner console</span>
        <div className="ml-auto flex items-center gap-2">{bar}</div>
      </div>
      <div className={gutter}>{children}</div>
    </main>
  );
}

function TokenGate() {
  const [value, setValue] = useState("");
  const rejected = tokenWasRejected();
  const submit = (e: FormEvent) => { e.preventDefault(); if (value.trim()) setToken(value.trim()); };
  return (
    <Shell>
      <form onSubmit={submit} className="mx-auto max-w-md py-24">
        <h1 className="font-heading text-heading text-ink">Health & <em>activity</em></h1>
        <p className="mt-4 text-muted">Paste the backend&apos;s read-only OPS_READ_TOKEN (never OPS_TOKEN). It stays in this tab only and is sent as a bearer header to the API.</p>
        <label htmlFor="ops-token" className="mt-8 block text-sm font-medium text-ink">Ops token</label>
        <input id="ops-token" type="password" autoComplete="off" spellCheck={false} required value={value} onChange={(e) => setValue(e.target.value)} aria-describedby={rejected ? "ops-token-error" : undefined} aria-invalid={rejected || undefined}
          className={cn("mt-2 block w-full rounded-lg border border-input bg-white px-3.5 py-3 font-mono text-base text-ink", focus)} />
        {rejected && <p id="ops-token-error" role="alert" className="mt-2 text-sm text-[#b42318]">That token was rejected (or ops endpoints are switched off on the API). Check OPS_READ_TOKEN and try again.</p>}
        <button type="submit" className={cn("mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-ink px-4 text-sm font-medium text-white hover:bg-ink/85", focus)}>Open console</button>
      </form>
    </Shell>
  );
}

function Dashboard({ token }: { token: string }) {
  const ov = useOps<Overview>("/admin/ops/overview", token);
  const { mutate } = useSWRConfig();
  const d = ov.data?.data;
  const bar = (
    <>
      <button type="button" className={btn} onClick={() => void mutate(() => true)} disabled={ov.isValidating}>{ov.isValidating ? "Refreshing…" : "Refresh"}</button>
      <button type="button" className={btn} onClick={() => setToken(null)}>Forget token</button>
    </>
  );
  return (
    <Shell bar={bar}>
      <header className="pt-10 sm:pt-14">
        <h1 className="font-heading text-heading text-ink">Health & <em>activity</em></h1>
        <Verdict ov={ov.data} error={ov.error} />
        <p className="mt-2 text-sm text-muted" aria-live="polite">
          {d ? <>Updated {fmtWhen(d.generatedAt)}. Refreshes every 30 seconds.</> : ov.error ? null : "Loading the first snapshot…"}
          {d?.status.metricsSince && <> Request metrics since {fmtWhen(d.status.metricsSince)}.</>}
        </p>
      </header>
      <StatusStrip d={d} loading={ov.isLoading} />
      <Traffic token={token} />
      <Queues d={d} state={ov} />
      <Errors token={token} />
      <Activity token={token} />
      <Business d={d} state={ov} />
      <Database d={d} state={ov} />
      <Costs d={d} state={ov} />
    </Shell>
  );
}

function Verdict({ ov, error }: { ov?: Overview; error?: OpsError }) {
  if (error && !ov) return <p role="alert" className="mt-6 text-xl text-[#b42318]">Down: {error.message} The API or its database is not answering.</p>;
  if (!ov) return <div className="mt-6 h-8 w-72 rounded bg-secondary motion-safe:animate-pulse" />;
  const s = ov.data.status;
  const [tone, word] = s.overall === "ok" ? (["ok", "All systems normal"] as const) : s.overall === "degraded" ? (["warn", "Degraded"] as const) : (["bad", "Down"] as const);
  return (
    <div className="mt-6">
      <p className={cn("flex items-center gap-2.5 text-xl font-medium sm:text-2xl", TONE[tone])}>
        <span aria-hidden className="size-2.5 rounded-full bg-current" />{word}
      </p>
      {s.reasons.length > 0 && <ul className="mt-2 list-disc pl-5 text-ink">{s.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
    </div>
  );
}

// ---- building blocks ----

function Panel({ id, title, accent, note, action, children }: { id: string; title: string; accent: string; note?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-12 border-t border-line pt-10 sm:mt-16 sm:pt-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 id={id} className="font-heading text-3xl text-ink sm:text-4xl">{title} <em>{accent}</em></h2>
        {action}
      </div>
      {note && <p className="mt-2 max-w-3xl text-sm text-muted">{note}</p>}
      <div className="mt-6 sm:mt-8">{children}</div>
    </section>
  );
}

function Load<T>({ state, label, children }: { state: { data?: T; error?: OpsError; isLoading: boolean; mutate: () => unknown }; label: string; children: (d: T) => ReactNode }) {
  if (state.data) return <>{children(state.data)}</>;
  if (state.error) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-4 rounded-lg border border-line px-4 py-4 text-sm">
        <span className="text-[#b42318]">Couldn&apos;t load {label}. {state.error.message}</span>
        <button type="button" className={btn} onClick={() => void state.mutate()}>Try again</button>
      </div>
    );
  }
  return <div aria-label={`Loading ${label}`} className="h-40 rounded-lg bg-secondary motion-safe:animate-pulse" />;
}

const Stat = ({ label, value, sub, tone = "none" }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone }) => (
  <div className="min-w-0 py-4">
    <dt className="text-sm text-muted">{label}</dt>
    <dd className={cn("mt-1 font-mono text-2xl tabular-nums", TONE[tone])}>{value}</dd>
    {sub && <dd className="mt-1 text-sm text-muted">{sub}</dd>}
  </div>
);

function Table({ head, right = [], rows, empty, caption }: { head: string[]; right?: number[]; rows: ReactNode[][]; empty: string; caption: string }) {
  if (!rows.length) return <p className="rounded-lg border border-dashed border-line px-4 py-6 text-sm text-muted">{empty}</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-max text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="text-muted"><tr>{head.map((h, i) => <th key={h} scope="col" className={cn("px-3 py-2.5 font-medium", right.includes(i) && "text-right")}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, ri) => <tr key={ri} className="border-t border-line">{r.map((c, i) => <td key={i} className={cn("px-3 py-2.5 align-top", right.includes(i) && "text-right font-mono tabular-nums")}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly { v: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border border-line p-1">
      {options.map((o) => (
        <button key={o.v} type="button" aria-pressed={value === o.v} onClick={() => onChange(o.v)}
          className={cn("min-h-10 min-w-12 rounded-md px-3 text-sm font-medium", value === o.v ? "bg-ink text-white" : "text-ink hover:bg-secondary", focus)}>{o.label}</button>
      ))}
    </div>
  );
}

/** Keyset pagination: a stack of `before` cursors, so "Newer" walks back without refetch tricks. */
function useCursor() {
  const [stack, setStack] = useState<number[]>([]);
  return { before: stack.at(-1), page: stack.length + 1, older: (n: number) => setStack((s) => [...s, n]), newer: () => setStack((s) => s.slice(0, -1)), reset: () => setStack([]) };
}

function Pager({ c, next }: { c: ReturnType<typeof useCursor>; next: number | null | undefined }) {
  return (
    <div className="mt-4 flex items-center gap-3">
      <button type="button" className={btn} disabled={c.page === 1} onClick={c.newer}>Newer</button>
      <span className="text-sm text-muted">Page {c.page}</span>
      <button type="button" className={btn} disabled={!next} onClick={() => next && c.older(next)}>Older</button>
    </div>
  );
}

/** UUIDs are cut to their first block; other ids (e.g. "pro/USD/month") are short and meaningful, so they stay whole. */
const shortId = (id: string | null) => (!id ? "" : /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id) ? id.slice(0, 8) : id);

const NotTracked = ({ children }: { children: ReactNode }) => <span className="text-muted">Not tracked yet: {children}</span>;

// ---- panels ----

function StatusStrip({ d, loading }: { d?: Overview["data"]; loading: boolean }) {
  if (!d) return loading ? <div className="mt-8 h-24 rounded-lg bg-secondary motion-safe:animate-pulse" /> : null;
  const s = d.status, cron = s.workers?.scheduling;
  const backlogAge = Math.max(s.backlog?.outboxOldestS ?? 0, d.queues.jobs?.oldestPendingAgeS ?? 0);
  const rate = s.errorRate1h.rate;
  return (
    <dl className="mt-8 grid grid-cols-2 gap-x-6 border-y border-line sm:grid-cols-3 lg:grid-cols-5">
      <Stat label="API" value="Up" tone="ok" sub="answered this snapshot" />
      <Stat label="Database" value={s.db.ok ? fmtMs(s.db.latencyMs) : "Unreachable"} tone={s.db.ok ? "none" : "bad"} sub={s.db.ok ? "connect + SELECT 1 via Hyperdrive" : undefined} />
      <Stat label="Backlog due now" value={fmtInt((s.backlog?.jobsDue ?? 0) + (s.backlog?.outboxDue ?? 0))} tone={backlogAge > 300 ? "warn" : "none"} sub={backlogAge ? `oldest ${fmtAge(backlogAge)}` : "nothing waiting"} />
      <Stat label="Last cron tick" value={cron?.lastBeatSecondsAgo !== undefined ? `${fmtAge(cron.lastBeatSecondsAgo)} ago` : "Never"} tone={cron?.alive ? "none" : "bad"} sub={cron?.alive ? "sweeper + outbox relay, every minute" : "Stalled: no tick in 3 minutes"} />
      <Stat label="5xx rate, last hour" value={fmtPct(rate)} tone={rate !== null && rate > 0.05 ? "bad" : "none"} sub={`of ${fmtInt(s.errorRate1h.requests)} requests`} />
    </dl>
  );
}

const RANGES = [{ v: "1h", label: "1h" }, { v: "24h", label: "24h" }, { v: "7d", label: "7d" }] as const;

function Traffic({ token }: { token: string }) {
  const [range, setRange] = useState<"1h" | "24h" | "7d">("24h");
  const m = useOps<Metrics>(`/admin/ops/metrics?range=${range}`, token);
  return (
    <Panel id="traffic" title="Requests and" accent="latency" action={<Segmented label="Time range" value={range} options={RANGES} onChange={setRange} />}
      note="Every API request, grouped by matched route. Percentiles are estimated from a latency histogram (bucket edges 5 ms to 30 s). Worker CPU time is not tracked yet.">
      <Load state={m} label="request metrics">
        {({ data }) => (
          <>
            <dl className="mb-8 grid grid-cols-2 gap-x-6 sm:grid-cols-4">
              <Stat label="Requests" value={fmtInt(data.totals.count)} />
              <Stat label="5xx rate" value={fmtPct(data.totals.errorRate)} sub={`${fmtInt(data.totals.errors5xx)} server errors`} tone={(data.totals.errorRate ?? 0) > 0.05 ? "bad" : "none"} />
              <Stat label="p95 latency" value={fmtMs(data.totals.p95)} sub={`p50 ${fmtMs(data.totals.p50)}`} />
              <Stat label="p99 latency" value={fmtMs(data.totals.p99)} sub={`4xx: ${fmtInt(data.totals.errors4xx)}`} />
            </dl>
            <TrafficCharts points={data.series} binSeconds={data.binSeconds} />
            <h3 className="mt-10 font-medium text-ink">By route group</h3>
            <div className="mt-3">
              <Table caption="Requests by route group" head={["Route group", "Requests", "5xx", "4xx", "5xx rate", "p50", "p95", "p99"]} right={[1, 2, 3, 4, 5, 6, 7]} empty="No requests in this range."
                rows={data.groups.map((g) => [<code key="g" className="font-mono text-xs">{g.group}</code>, fmtInt(g.count), fmtInt(g.errors5xx), fmtInt(g.errors4xx), <span key="r" className={(g.errorRate ?? 0) > 0.05 ? TONE.bad : undefined}>{fmtPct(g.errorRate)}</span>, fmtMs(g.p50), fmtMs(g.p95), fmtMs(g.p99)])} />
            </div>
          </>
        )}
      </Load>
    </Panel>
  );
}

type OvState = { data?: Overview; error?: OpsError; isLoading: boolean; mutate: () => unknown };

function Queues({ d, state }: { d?: Overview["data"]; state: OvState }) {
  return (
    <Panel id="queues" title="Queues and" accent="jobs" note="Cloudflare Queues exposes no depth to Workers, so backlog is read from Postgres (jobs + outbox), which is the source of truth. Dead letters are counted from when this console shipped.">
      <Load state={state} label="queue state">
        {() => {
          const j = d!.queues.jobs, o = d!.queues.outbox, w = d!.status.workers;
          return (
            <>
              <dl className="grid grid-cols-2 gap-x-6 sm:grid-cols-4">
                <Stat label="Pending" value={fmtInt(j?.pending)} sub={`${fmtInt(j?.pendingDue)} due now, oldest ${fmtAge(j?.oldestPendingAgeS)}`} />
                <Stat label="Scheduled" value={fmtInt(j?.scheduled)} sub="waiting for their time" />
                <Stat label="Leased" value={fmtInt(j?.leased)} tone={(j?.leaseExpired ?? 0) > 0 ? "warn" : "none"} sub={`${fmtInt(j?.leaseExpired)} lease expired, ${fmtInt(j?.reconciling)} reconciling`} />
                <Stat label="Failed, 24h" value={fmtInt(j?.failed24h)} tone={(j?.failed24h ?? 0) > 0 ? "bad" : "none"} sub={`${fmtInt(j?.exhausted24h)} out of retries`} />
                <Stat label="Outbox due" value={fmtInt(o?.due)} sub={o?.oldestDueS ? `oldest ${fmtAge(o.oldestDueS)}` : "nothing waiting"} />
                <Stat label="Publish consumer" value={w?.publishing.alive ? "Active" : "Idle"} sub={w?.publishing.lastBeatSecondsAgo !== undefined ? `last batch ${fmtAge(w.publishing.lastBeatSecondsAgo)} ago` : "no batch seen yet"} />
                <Stat label="Analytics consumer" value={w?.analytics.alive ? "Active" : "Idle"} sub={w?.analytics.lastBeatSecondsAgo !== undefined ? `last batch ${fmtAge(w.analytics.lastBeatSecondsAgo)} ago` : "no batch seen yet"} />
                <Stat label="Dead letters, 7d" value={fmtInt(d!.queues.dlq?.reduce((s, q) => s + q.last7d, 0))} tone={d!.queues.dlq?.length ? "bad" : "none"} sub={d!.queues.dlq?.length ? d!.queues.dlq.map((q) => `${q.queue}: ${q.last24h} in 24h`).join(", ") : "none"} />
              </dl>
              <h3 className="mt-8 font-medium text-ink">Recent publish failures</h3>
              <div className="mt-3">
                <Table caption="Recent publish failures" head={["When", "Platform", "Code", "Message", "Job"]} empty="No failed publish jobs. Failures show here with their error code."
                  rows={(d!.queues.recentFailures ?? []).map((f) => [<span key="w" className="whitespace-nowrap">{fmtWhen(f.at)}</span>, f.platform, <code key="c" className="font-mono text-xs">{f.code ?? "--"}</code>, <span key="m" className="block max-w-md break-words">{f.message ?? "--"}</span>, <code key="j" className="font-mono text-xs text-muted">{f.jobId.slice(0, 8)}</code>])} />
              </div>
            </>
          );
        }}
      </Load>
    </Panel>
  );
}

const SOURCES = [{ v: "all", label: "All" }, { v: "http", label: "HTTP 500" }, { v: "dlq", label: "Dead letters" }] as const;

function Errors({ token }: { token: string }) {
  const [source, setSource] = useState<"all" | "http" | "dlq">("all");
  const c = useCursor();
  const q = new URLSearchParams({ limit: "20", ...(source !== "all" ? { source } : {}), ...(c.before ? { before: String(c.before) } : {}) });
  const e = useOps<ErrorPage>(`/admin/ops/errors?${q}`, token);
  return (
    <Panel id="errors" title="Server" accent="errors" note="Unhandled errors (HTTP 500) and dead-lettered queue messages. Only method, path, request id and a redacted message are stored: no bodies, headers, emails or tokens. Kept 30 days."
      action={<Segmented label="Error source" value={source} options={SOURCES} onChange={(v) => { setSource(v); c.reset(); }} />}>
      <Load state={e} label="server errors">
        {({ data, meta }) => (
          <>
            <Table caption="Server errors" head={["When", "Source", "Route", "Message", "Request id"]} empty="No server errors recorded. That is the goal."
              rows={data.map((x) => [<span key="w" className="whitespace-nowrap">{fmtWhen(x.at)}</span>, x.source === "http" ? "HTTP 500" : "Dead letter", <code key="r" className="font-mono text-xs">{x.method ? `${x.method} ` : ""}{x.route}</code>, <span key="m" className="block max-w-md break-words">{x.message}</span>, <code key="i" className="font-mono text-xs text-muted">{x.requestId ?? "--"}</code>])} />
            <Pager c={c} next={meta.nextBefore} />
          </>
        )}
      </Load>
    </Panel>
  );
}

function Activity({ token }: { token: string }) {
  const [ws, setWs] = useState<{ id: string; name: string } | null>(null);
  const [action, setAction] = useState("");
  const c = useCursor();
  const q = new URLSearchParams({ limit: "25", ...(ws ? { workspaceId: ws.id } : {}), ...(action ? { action } : {}), ...(c.before ? { before: String(c.before) } : {}) });
  const a = useOps<AuditPage>(`/admin/ops/audit?${q}`, token);
  const actions = a.data?.meta.actions ?? [];
  return (
    <Panel id="activity" title="Activity" accent="log" note="The audit log across every workspace, newest first. Pick a workspace name to see only that workspace.">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="audit-action" className="block text-sm font-medium text-ink">Action</label>
          <select id="audit-action" value={action} onChange={(e) => { setAction(e.target.value); c.reset(); }} className={cn("mt-1 min-h-11 rounded-lg border border-input bg-white px-3 text-sm text-ink", focus)}>
            <option value="">All actions</option>
            {actions.map((x) => <option key={x.action} value={x.action}>{x.action} ({x.n})</option>)}
          </select>
        </div>
        {ws && (
          <button type="button" className={btn} onClick={() => { setWs(null); c.reset(); }} aria-label={`Clear workspace filter ${ws.name}`}>
            Workspace: {ws.name} <span aria-hidden className="ml-2 text-muted">×</span>
          </button>
        )}
      </div>
      <Load state={a} label="the audit log">
        {({ data, meta }) => (
          <>
            <Table caption="Audit log" head={["When", "Who", "Action", "Target", "Workspace"]} empty={ws || action ? "Nothing matches these filters." : "No audit entries yet. Workspace changes, invites, publishing and billing actions land here."}
              rows={data.map((x) => [
                <span key="w" className="whitespace-nowrap">{fmtWhen(x.at)}</span>,
                <span key="u" className="block max-w-56 truncate" title={x.actorEmail ?? undefined}>{x.actorEmail ?? (x.actorId ? "deleted user" : "system")}</span>,
                <code key="a" className="font-mono text-xs">{x.action}</code>,
                <span key="t" className="text-muted">{x.targetType ? `${x.targetType} ${shortId(x.targetId)}` : "--"}</span>,
                x.workspaceId ? <button key="ws" type="button" className={cn("min-h-10 rounded text-left underline decoration-line underline-offset-4 hover:decoration-ink", focus)} onClick={() => { setWs({ id: x.workspaceId!, name: x.workspaceName ?? x.workspaceId!.slice(0, 8) }); c.reset(); }}>{x.workspaceName ?? x.workspaceId.slice(0, 8)}</button> : <span key="ws" className="text-muted">none</span>,
              ])} />
            <Pager c={c} next={meta.nextBefore} />
          </>
        )}
      </Load>
    </Panel>
  );
}

function Business({ d, state }: { d?: Overview["data"]; state: OvState }) {
  return (
    <Panel id="business" title="Users and" accent="publishing" note="Publish outcomes come from publishing jobs: published by publish time, failed by when they failed.">
      <Load state={state} label="business numbers">
        {() => {
          const b = d!.business;
          return (
            <>
              <dl className="grid grid-cols-2 gap-x-6 sm:grid-cols-4">
                <Stat label="Users" value={fmtInt(b.users)} sub={`${fmtInt(b.usersLast7d)} joined in 7 days`} />
                <Stat label="Workspaces" value={fmtInt(b.workspaces)} />
                <Stat label="Live subscriptions" value={fmtInt(b.subscriptions?.reduce((s, x) => s + x.n, 0))} sub={b.subscriptions?.map((s) => `${s.plan} ${s.status}: ${s.n}`).join(", ") || "none yet"} />
                <Stat label="Billing webhooks failed" value={fmtInt(b.billingWebhooksFailed)} tone={(b.billingWebhooksFailed ?? 0) > 0 ? "bad" : "none"} sub="retry from /admin/billing" />
              </dl>
              <div className="mt-8 grid gap-8 lg:grid-cols-2">
                <div>
                  <h3 className="font-medium text-ink">Publishing by platform</h3>
                  <div className="mt-3">
                    <Table caption="Publishing by platform" head={["Platform", "Published 24h", "Failed 24h", "Published 7d", "Failed 7d", "Success 7d"]} right={[1, 2, 3, 4, 5]} empty="Nothing published or failed in the last 7 days."
                      rows={(b.publishingByPlatform ?? []).map((p) => [p.platform, fmtInt(p.published24h), fmtInt(p.failed24h), fmtInt(p.published7d), fmtInt(p.failed7d), fmtPct(p.successRate7d)])} />
                  </div>
                </div>
                <div>
                  <h3 className="font-medium text-ink">Connected accounts</h3>
                  <div className="mt-3">
                    <Table caption="Connected accounts by platform" head={["Platform", "Active", "Needs re-auth", "Disconnected"]} right={[1, 2, 3]} empty="No social accounts connected yet."
                      rows={(b.accountsByPlatform ?? []).map((a) => [a.platform, fmtInt(a.active), <span key="r" className={a.needsReauth ? TONE.warn : undefined}>{fmtInt(a.needsReauth)}</span>, fmtInt(a.disconnected)])} />
                  </div>
                </div>
              </div>
            </>
          );
        }}
      </Load>
    </Panel>
  );
}

function Database({ d, state }: { d?: Overview["data"]; state: OvState }) {
  return (
    <Panel id="database" title="Database and" accent="storage">
      <Load state={state} label="database stats">
        {() => {
          const db = d!.database, st = d!.storage, used = db.sizeBytes !== null ? db.sizeBytes / db.planLimitBytes : null;
          return (
            <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
              <div>
                <p className="text-sm text-muted">Postgres size against the Neon {db.planName} cap ({db.planLimitSource === "neon.max_cluster_size" ? "read live from Neon" : "plan constant"})</p>
                <p className="mt-2 font-mono text-3xl text-ink tabular-nums">{fmtBytes(db.sizeBytes)} <span className="text-lg text-muted">of {fmtBytes(db.planLimitBytes)}</span></p>
                <div role="meter" aria-label="Database storage used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={used === null ? undefined : Math.round(used * 100)} className="mt-3 h-2.5 overflow-hidden rounded-full bg-secondary">
                  <div className={cn("h-full rounded-full", (used ?? 0) > 0.8 ? "bg-[#b42318]" : "bg-ink")} style={{ width: `${Math.max(Math.min((used ?? 0) * 100, 100), 0.5)}%` }} />
                </div>
                <p className="mt-2 text-sm text-muted">{fmtPct(used)} used. Round trip {fmtMs(db.latencyMs)}.</p>
                <h3 className="mt-8 font-medium text-ink">Media storage (R2)</h3>
                <dl className="grid grid-cols-2 gap-x-6">
                  <Stat label="Objects" value={fmtInt(st?.trackedObjects)} />
                  <Stat label="Bytes" value={fmtBytes(st?.trackedBytes)} />
                </dl>
                <p className="text-sm text-muted">Counted from uploaded media rows, not by listing the bucket. <NotTracked>R2 operations and egress.</NotTracked></p>
              </div>
              <div>
                <h3 className="font-medium text-ink">Largest tables</h3>
                <div className="mt-3">
                  <Table caption="Largest tables" head={["Table", "Size incl. indexes", "Rows (estimate)"]} right={[1, 2]} empty="No table statistics."
                    rows={(db.tables ?? []).map((t) => [<code key="n" className="font-mono text-xs">{t.name}</code>, fmtBytes(t.totalBytes), fmtInt(t.rows)])} />
                </div>
                <p className="mt-2 text-sm text-muted">Row counts are Postgres&apos; live-tuple statistics, not exact counts.</p>
              </div>
            </div>
          );
        }}
      </Load>
    </Panel>
  );
}

function Costs({ d, state }: { d?: Overview["data"]; state: OvState }) {
  return (
    <Panel id="costs" title="Monthly cost" accent="estimate" note="An estimate, not a bill: list prices in one backend file applied to what we measure (request volume projected to 30 days, database size, media bytes). Check the Cloudflare and Neon dashboards for real invoices.">
      <Load state={state} label="the cost estimate">
        {() => {
          const c = d!.costs;
          return (
            <>
              <Table caption="Monthly cost estimate" head={["Item", "Basis", "Estimate"]} right={[2]} empty="No cost items."
                rows={[...c.items.map((i) => [i.label, <span key="b" className="text-muted">{i.basis}</span>, fmtUsd(i.usd)]), [<strong key="t">Total (estimate)</strong>, <span key="p" className="text-muted">prices as of {c.pricesAsOf}</span>, <strong key="v">{fmtUsd(c.totalUsd)}</strong>]]} />
              <p className="mt-3 text-sm"><NotTracked>{c.notTracked.join(", ")}.</NotTracked></p>
            </>
          );
        }}
      </Load>
    </Panel>
  );
}
