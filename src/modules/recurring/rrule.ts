import { zonedLocalToUtc } from "../../shared/utils/timezone.js";

export interface Rule { frequency: "daily" | "weekly" | "monthly"; interval: number; startLocal: string; timezone: string; count?: number | null | undefined; untilDate?: string | null | undefined }

const pad = (n: number) => String(n).padStart(2, "0");
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Wall-clock datetime of occurrence n (0-based). Monthly series keep the day of month, clamped to the month's length (31st -> 30th/28th). */
export function localOf(rule: Rule, n: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})$/.exec(rule.startLocal)!;
  const [y, mo, d, hm] = [Number(m[1]), Number(m[2]), Number(m[3]), m[4]!];
  if (rule.frequency === "monthly") {
    const total = (mo - 1) + n * rule.interval, ny = y + Math.floor(total / 12), nm = (total % 12) + 1;
    return `${ny}-${pad(nm)}-${pad(Math.min(d, daysInMonth(ny, nm)))}T${hm}`;
  }
  const dt = new Date(Date.UTC(y, mo - 1, d)); dt.setUTCDate(dt.getUTCDate() + n * rule.interval * (rule.frequency === "weekly" ? 7 : 1));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}T${hm}`;
}

/**
 * UTC instant of occurrence n, or null when the series is over (count / until date). DST: a wall time that does not exist is moved
 * forward by an hour; one that happens twice uses the earlier occurrence. The series keeps its wall-clock time across DST changes.
 */
export function occurrenceAt(rule: Rule, n: number): Date | null {
  if (rule.count != null && n >= rule.count) return null;
  const local = localOf(rule, n);
  if (rule.untilDate && local.slice(0, 10) > rule.untilDate) return null;
  let r = zonedLocalToUtc(local, rule.timezone);
  if (!r.ok && r.reason === "nonexistent_local_time") {
    const [h, mi] = [Number(local.slice(11, 13)) + 1, local.slice(14, 16)];
    r = zonedLocalToUtc(`${local.slice(0, 11)}${pad(h)}:${mi}`, rule.timezone);
  }
  return r.ok ? r.utc : null;
}
