export type Cell = string | number | boolean | null | undefined;

/**
 * RFC 4180 CSV. Strings that a spreadsheet would execute as formulas (=, +, -, @, tab, CR) are prefixed with an apostrophe
 * (CSV injection guard; user-controlled titles end up in these files). Numbers are written as numbers; null/undefined is an EMPTY cell,
 * so "unavailable" is never exported as 0.
 */
export function cell(v: Cell): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "true" : "false";
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
export const toCsv = (header: string[], rows: Cell[][]) => [header.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))].join("\r\n") + "\r\n";
