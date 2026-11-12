import type { Cell } from "./csv.js";

// Minimal PDF 1.4 table writer (no dependency): A4 landscape, built-in Helvetica (WinAnsi), paginated, with a header row repeated per page.
// Limits (documented): Latin-1 text only (other characters print as "?"), cells are truncated to fit their column.
const W = 842, H = 595, MARGIN = 28, FONT = 7, LEADING = 11, HEADER_H = 44, FOOTER_H = 22;
const CHAR_W = FONT * 0.52;     // average Helvetica glyph width; columns are sized from this, so wide cells are truncated rather than overlapped

const esc = (s: string) => s.replace(/[^\x20-\x7e\xa0-\xff]/g, "?").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
const text = (v: Cell) => (v === null || v === undefined ? "" : typeof v === "boolean" ? (v ? "true" : "false") : String(v));

export function toPdf(title: string, subtitle: string, header: string[], rows: Cell[][]): Buffer {
  const usable = W - 2 * MARGIN;
  // column widths proportional to the longest content (capped), then scaled to the page
  const want = header.map((h, i) => Math.min(40, Math.max(h.length, ...rows.slice(0, 200).map((r) => text(r[i]).length), 4)) + 2);
  const scale = usable / (want.reduce((a, b) => a + b, 0) * CHAR_W);
  const widths = want.map((w) => w * CHAR_W * Math.min(scale, 1.6));
  const xs = widths.reduce<number[]>((acc, w, i) => (acc.push(i === 0 ? MARGIN : acc[i - 1]! + widths[i - 1]!), acc), []);
  const fit = (s: string, w: number) => { const max = Math.max(1, Math.floor((w - 3) / CHAR_W)); return s.length > max ? s.slice(0, Math.max(1, max - 1)) + "." : s; };

  const perPage = Math.floor((H - 2 * MARGIN - HEADER_H - FOOTER_H) / LEADING) - 1;
  const pages: string[] = [];
  const chunks = rows.length ? Array.from({ length: Math.ceil(rows.length / perPage) }, (_, i) => rows.slice(i * perPage, (i + 1) * perPage)) : [[]];
  chunks.forEach((chunk, pi) => {
    const out: string[] = [];
    const put = (x: number, y: number, s: string, size = FONT, bold = false) => out.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(1)} ${y.toFixed(1)} Td (${esc(s)}) Tj ET`);
    put(MARGIN, H - MARGIN - 8, title, 13, true);
    put(MARGIN, H - MARGIN - 22, subtitle, 8);
    let y = H - MARGIN - HEADER_H;
    out.push(`0.93 0.93 0.95 rg ${MARGIN} ${y - 3} ${usable} ${LEADING} re f 0 g`);
    header.forEach((h, i) => put(xs[i]! + 1.5, y, fit(h, widths[i]!), FONT, true));
    y -= LEADING;
    chunk.forEach((r, ri) => {
      if (ri % 2 === 1) out.push(`0.975 0.975 0.98 rg ${MARGIN} ${y - 3} ${usable} ${LEADING} re f 0 g`);
      header.forEach((_h, i) => put(xs[i]! + 1.5, y, fit(text(r[i]), widths[i]!)));
      y -= LEADING;
    });
    put(MARGIN, MARGIN - 4, `Page ${pi + 1} of ${chunks.length}  |  ${rows.length} row${rows.length === 1 ? "" : "s"}`, 7);
    pages.push(out.join("\n"));
  });

  // objects: 1 catalog, 2 pages, 3 font, 4 bold font, then (page, content) pairs
  const objs: string[] = [];
  const kids = pages.map((_, i) => `${5 + i * 2} 0 R`).join(" ");
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objs[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  pages.forEach((content, i) => {
    objs[5 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`;
    objs[6 + i * 2] = `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`;
  });
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let n = 1; n < objs.length; n++) { offsets[n] = Buffer.byteLength(pdf, "latin1"); pdf += `${n} 0 obj\n${objs[n]}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objs.length}\n0000000000 65535 f \n` + offsets.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}
