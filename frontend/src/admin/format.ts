// Display-only number formatting for the ops dashboard. Null, NaN and Infinity render as "--",
// never as 0: an unknown value must not look like a measured one.
type V = number | null | undefined;
const bad = (v: V): v is null | undefined => v === null || v === undefined || !Number.isFinite(v);
const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export const fmtInt = (v: V) => (bad(v) ? "--" : int.format(v));

export function fmtMs(v: V) {
  if (bad(v)) return "--";
  if (v === 0) return "0 ms";
  if (v < 1) return "<1 ms";
  return v < 1000 ? `${int.format(v)} ms` : `${(v / 1000).toFixed(2)} s`;
}

/** Ratio 0..1 shown as a percent. */
export function fmtPct(v: V) {
  if (bad(v)) return "--";
  if (v === 0) return "0.00%";
  if (v < 0.0001) return "<0.01%";
  return `${(v * 100).toFixed(2)}%`;
}

/** Binary units, labelled as such (Neon reports its cap in MiB). */
export function fmtBytes(v: V) {
  if (bad(v)) return "--";
  if (v < 1024) return `${int.format(v)} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let n = v / 1024, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
}

export function fmtAge(s: V) {
  if (bad(s)) return "--";
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

export const fmtUsd = (v: V) => (bad(v) ? "--" : `$${v.toFixed(2)}`);

const when = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
export const fmtWhen = (iso: string | null | undefined) => (iso ? when.format(new Date(iso)) : "--");
const clock = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
/** Axis/tooltip label for a time bin: clock time for the 1-hour range, day + time once the range crosses midnight. */
export const fmtBin = (iso: string, binSeconds: number) => (binSeconds >= 900 ? when.format(new Date(iso)) : clock.format(new Date(iso)));
