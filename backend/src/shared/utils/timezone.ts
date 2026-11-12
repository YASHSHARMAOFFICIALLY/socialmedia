// Timezone math with Intl only (no dependency; works on Workers and Node).
export function isValidTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

const parts = (utcMs: number, tz: string) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return { y: +p.year!, mo: +p.month!, d: +p.day!, h: +p.hour!, mi: +p.minute!, s: +p.second! };
};
/** Offset (ms) of `tz` from UTC at the given instant. */
const offsetMs = (utcMs: number, tz: string) => { const q = parts(utcMs, tz); return Date.UTC(q.y, q.mo - 1, q.d, q.h, q.mi, q.s) - Math.floor(utcMs / 1000) * 1000; };

export type ZonedResult = { ok: true; utc: Date; ambiguous: boolean } | { ok: false; reason: "invalid_timezone" | "invalid_datetime" | "nonexistent_local_time" };

/**
 * Converts a wall-clock time ("2026-03-29T02:30:00") in an IANA zone to a UTC instant.
 * DST gap (time never occurs) => rejected. DST overlap (time occurs twice) => the EARLIER instant, flagged ambiguous.
 */
export function zonedLocalToUtc(local: string, tz: string): ZonedResult {
  if (!isValidTimeZone(tz)) return { ok: false, reason: "invalid_timezone" };
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local);
  if (!m) return { ok: false, reason: "invalid_datetime" };
  const [y, mo, d, h, mi, s] = [+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!, +(m[6] ?? 0)];
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  if (new Date(wall).getUTCMonth() !== mo - 1 || h > 23 || mi > 59) return { ok: false, reason: "invalid_datetime" };
  // Candidate instants = wall - offset for offsets seen around the date (covers both sides of a transition).
  const offsets = new Set([offsetMs(wall - 86_400_000, tz), offsetMs(wall + 86_400_000, tz)]);
  const valid = [...offsets].map((o) => wall - o).filter((utc) => offsetMs(utc, tz) === wall - utc).sort((a, b) => a - b);
  if (valid.length === 0) return { ok: false, reason: "nonexistent_local_time" };
  return { ok: true, utc: new Date(valid[0]!), ambiguous: valid.length > 1 };
}

/** "YYYY-MM-DD" of an instant in a zone (calendar day grouping). */
export function localDate(utc: Date | string, tz: string): string {
  const q = parts(new Date(utc).getTime(), tz);
  return `${q.y}-${String(q.mo).padStart(2, "0")}-${String(q.d).padStart(2, "0")}`;
}
export function localIso(utc: Date | string, tz: string): string {
  const q = parts(new Date(utc).getTime(), tz);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${q.y}-${p(q.mo)}-${p(q.d)}T${p(q.h)}:${p(q.mi)}:${p(q.s)}`;
}
