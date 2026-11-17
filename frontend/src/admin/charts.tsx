"use client";

import { useState, type PointerEvent, type ReactNode } from "react";
import { fmtBin, fmtInt, fmtMs } from "./format";

// Two small time charts, one y-axis each (never a dual axis). Marks are SVG stretched to the box
// (vector-effect keeps strokes 2px); dots and all text are HTML so nothing distorts.
// Colors validated with the dataviz palette script: p50 blue + p95 orange pass lightness, chroma, CVD and contrast on white.
// 5xx is the reserved "critical" status red and always carries its label.
const P50 = "#2a6fdb", P95 = "#e5531a", REQ = "#8a8a92", ERR = "#b42318";

type Point = { t: string; count: number; errors5xx: number; p50: number | null; p95: number | null };

function Frame({ n, bars, binSeconds, points, yMax, yFmt, tooltip, children, label }: { n: number; bars: boolean; binSeconds: number; points: Point[]; yMax: number; yFmt: (v: number) => string; tooltip: (p: Point) => ReactNode; children: ReactNode; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const pos = (i: number) => (bars ? ((i + 0.5) / n) * 100 : n > 1 ? (i / (n - 1)) * 100 : 50);
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.min(Math.max(e.clientX - r.left, 0), r.width - 1) / r.width;
    setHover(bars ? Math.floor(x * n) : Math.round(x * (n - 1)));
  };
  const hp = hover === null ? null : points[hover];
  return (
    <div>
      <div className="relative h-44 sm:h-52" role="img" aria-label={label} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-line" />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-line" />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 border-t border-line" />
        <span aria-hidden className="absolute top-1 left-0 bg-white/90 pr-1 font-mono text-xs text-muted tabular-nums">{yFmt(yMax)}</span>
        {children}
        {hp && hover !== null && (
          <>
            <div aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-ink/30" style={{ left: `${pos(hover)}%` }} />
            <div className={`pointer-events-none absolute top-2 z-10 min-w-40 rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-sm ${pos(hover) > 55 ? "-translate-x-[calc(100%+12px)]" : "translate-x-3"}`} style={{ left: `${pos(hover)}%` }}>
              <p className="font-medium text-ink">{fmtBin(hp.t, binSeconds)}</p>
              <div className="mt-1 space-y-0.5 font-mono tabular-nums text-ink">{tooltip(hp)}</div>
            </div>
          </>
        )}
      </div>
      <div aria-hidden className="mt-2 flex justify-between font-mono text-xs text-muted tabular-nums">
        <span>{points[0] ? fmtBin(points[0].t, binSeconds) : ""}</span>
        <span>{points.length ? fmtBin(points[points.length - 1]!.t, binSeconds) : ""}</span>
      </div>
    </div>
  );
}

// Text stays in ink; the coloured dot carries series identity.
const Dot = ({ color }: { color: string }) => <span aria-hidden className="mr-1.5 inline-block size-2 rounded-full align-middle" style={{ background: color }} />;

const Swatch = ({ color, label, line }: { color: string; label: string; line?: boolean }) => (
  <span className="inline-flex items-center gap-1.5 text-sm text-ink">
    <span aria-hidden className={line ? "h-0.5 w-4 rounded-full" : "size-2.5 rounded-sm"} style={{ background: color }} />
    {label}
  </span>
);

function DataTable({ points, binSeconds }: { points: Point[]; binSeconds: number }) {
  const rows = points.filter((p) => p.count > 0);
  return (
    <details className="mt-3 text-sm">
      <summary className="inline-flex min-h-10 cursor-pointer items-center rounded-md text-muted hover:text-ink focus-visible:ring-2 focus-visible:ring-ring">Show as table ({rows.length} bins with traffic)</summary>
      <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-line">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-white text-muted"><tr><th className="px-3 py-2 font-medium">Time</th><th className="px-3 py-2 text-right font-medium">Requests</th><th className="px-3 py-2 text-right font-medium">5xx</th><th className="px-3 py-2 text-right font-medium">p50</th><th className="px-3 py-2 text-right font-medium">p95</th></tr></thead>
          <tbody className="font-mono tabular-nums">
            {rows.map((p) => (
              <tr key={p.t} className="border-t border-line"><td className="px-3 py-1.5">{fmtBin(p.t, binSeconds)}</td><td className="px-3 py-1.5 text-right">{fmtInt(p.count)}</td><td className="px-3 py-1.5 text-right">{fmtInt(p.errors5xx)}</td><td className="px-3 py-1.5 text-right">{fmtMs(p.p50)}</td><td className="px-3 py-1.5 text-right">{fmtMs(p.p95)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export function TrafficCharts({ points, binSeconds }: { points: Point[]; binSeconds: number }) {
  const n = points.length;
  const total = points.reduce((s, p) => s + p.count, 0);
  if (!n || !total) return <p className="rounded-lg border border-dashed border-line px-4 py-10 text-center text-sm text-muted">No requests recorded in this range yet. Metrics start the moment the API serves traffic.</p>;
  const maxCount = Math.max(...points.map((p) => p.count), 1);
  const maxMs = Math.max(...points.flatMap((p) => [p.p50 ?? 0, p.p95 ?? 0]), 1);
  const y = (v: number) => 100 - (v / maxMs) * 100;
  const xLine = (i: number) => (n > 1 ? (i / (n - 1)) * 100 : 50);
  const path = (key: "p50" | "p95") => {
    let d = "", pen = false;
    points.forEach((p, i) => { const v = p[key]; if (v === null) { pen = false; return; } d += `${pen ? "L" : "M"}${xLine(i)} ${y(v)} `; pen = true; });
    return d;
  };
  return (
    <div className="grid gap-10 lg:grid-cols-2">
      <figure>
        <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-medium text-ink">Requests per {binSeconds >= 3600 ? `${binSeconds / 3600} h` : `${binSeconds / 60} min`}</span>
          <span className="flex gap-4"><Swatch color={REQ} label="Requests" /><Swatch color={ERR} label="5xx" /></span>
        </figcaption>
        <div className="mt-3">
          <Frame n={n} bars binSeconds={binSeconds} points={points} yMax={maxCount} yFmt={(v) => fmtInt(v)} label={`Requests over time, ${fmtInt(total)} in total, peak ${fmtInt(maxCount)} per bin`} tooltip={(p) => (<><p><Dot color={REQ} />{fmtInt(p.count)} requests</p><p><Dot color={ERR} />{fmtInt(p.errors5xx)} 5xx</p></>)}>
            <svg aria-hidden viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" className="absolute inset-0 size-full">
              {points.map((p, i) => {
                const h = (p.count / maxCount) * 100, eh = (p.errors5xx / maxCount) * 100;
                return p.count ? (
                  <g key={p.t}>
                    <rect x={i + 0.12} width={0.76} y={100 - h} height={h - eh} fill={REQ} />
                    {eh > 0 && <rect x={i + 0.12} width={0.76} y={100 - eh} height={eh} fill={ERR} />}
                  </g>
                ) : null;
              })}
            </svg>
          </Frame>
        </div>
      </figure>
      <figure>
        <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-medium text-ink">Latency (estimated from histogram)</span>
          <span className="flex gap-4"><Swatch color={P50} label="p50" line /><Swatch color={P95} label="p95" line /></span>
        </figcaption>
        <div className="mt-3">
          <Frame n={n} bars={false} binSeconds={binSeconds} points={points} yMax={maxMs} yFmt={fmtMs} label={`Latency over time, peak p95 ${fmtMs(Math.max(...points.map((p) => p.p95 ?? 0)))}`} tooltip={(p) => (p.count ? (<><p><Dot color={P50} />p50 {fmtMs(p.p50)}</p><p><Dot color={P95} />p95 {fmtMs(p.p95)}</p></>) : <p className="text-muted">No requests</p>)}>
            <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
              <path d={path("p50")} fill="none" stroke={P50} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
              <path d={path("p95")} fill="none" stroke={P95} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            </svg>
            {/* Dots keep isolated points visible: low-traffic bins often stand alone between empty ones. */}
            {points.flatMap((p, i) => (["p50", "p95"] as const).filter((k) => p[k] !== null).map((k) => (
              <span key={`${p.t}${k}`} aria-hidden className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white" style={{ left: `${xLine(i)}%`, top: `${y(p[k]!)}%`, background: k === "p50" ? P50 : P95 }} />
            )))}
          </Frame>
        </div>
      </figure>
      <div className="lg:col-span-2 -mt-6"><DataTable points={points} binSeconds={binSeconds} /></div>
    </div>
  );
}
