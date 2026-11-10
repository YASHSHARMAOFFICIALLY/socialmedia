import { z } from "zod";
import type { Db } from "../../infrastructure/database/db.js";
import type { Logger } from "../../infrastructure/logger/logger.js";
import { AppError, badRequest, notFound } from "../../shared/errors/errors.js";
import { decodeCursor, page } from "../../shared/utils/pagination.js";
import { auditRepository } from "../audit/audit.repository.js";
import type { AnalyticsService } from "../analytics/analytics.service.js";
import { defaultRange } from "../analytics/analytics.service.js";
import type { Actor, WorkspaceService } from "../workspaces/workspace.service.js";
import { toCsv } from "./csv.js";
import { toPdf } from "./pdf.js";
import { generate, MAX_ROWS, type ReportParams, type ReportType } from "./report.generators.js";

const cursorSchema = z.object({ createdAt: z.string(), id: z.string() });
const COLS = "id, type, format, params, status, row_count, error, created_at, finished_at, expires_at";
const PDF_MAX_ROWS = 3000;
interface Row { id: string; type: string; format: string; params: ReportParams; status: string; row_count: number | null; error: string | null; created_at: string; finished_at: string | null; expires_at: string }
const view = (r: Row) => ({ id: r.id, type: r.type, format: r.format, params: r.params, status: r.status, rows: r.row_count, error: r.error, createdAt: r.created_at, finishedAt: r.finished_at, expiresAt: r.expires_at, downloadable: r.status === "done" });

export function createReportService(deps: { db: Db; workspaces: WorkspaceService; analytics: AnalyticsService; log: Logger }) {
  const { db, workspaces } = deps;

  return {
    /** Asynchronous: the export is queued and produced by the background sweep; poll the status endpoint, then download. */
    async create(a: Actor, workspaceId: string, i: { type: ReportType; from?: string | undefined; to?: string | undefined; platform?: string | undefined; campaignId?: string | undefined; grain?: string | undefined; format?: "csv" | "pdf" | undefined }) {
      await workspaces.authorize(a.id, workspaceId, "reports:export");
      await workspaces.authorize(a.id, workspaceId, "analytics:read");
      const r = { ...defaultRange(), ...(i.from ? { from: i.from } : {}), ...(i.to ? { to: i.to } : {}) };
      if (r.from > r.to) throw badRequest("`from` must not be after `to`");
      if ((Date.parse(r.to) - Date.parse(r.from)) / 86_400_000 > 366) throw badRequest("Range is limited to 366 days");
      if (i.campaignId && !(await db.query("SELECT 1 FROM campaigns WHERE workspace_id = $1 AND id = $2", [workspaceId, i.campaignId])).rowCount) throw notFound("Campaign");
      const params: ReportParams = { ...r, ...(i.platform ? { platform: i.platform } : {}), ...(i.campaignId ? { campaignId: i.campaignId } : {}), ...(i.grain ? { grain: i.grain as never } : {}) };
      const row = (await db.query<Row>(`INSERT INTO export_jobs (workspace_id, requested_by, type, params, format) VALUES ($1,$2,$3,$4,$5) RETURNING ${COLS}`, [workspaceId, a.id, i.type, JSON.stringify(params), i.format ?? "csv"])).rows[0]!;
      await auditRepository.record(db, { workspaceId, actorId: a.id, action: "report.requested", entityType: "export", entityId: row.id, metadata: { type: i.type }, ...(a.requestId ? { requestId: a.requestId } : {}) });
      return view(row);
    },
    async list(a: Actor, workspaceId: string, f: { limit: number; cursor?: string | undefined }) {
      await workspaces.authorize(a.id, workspaceId, "reports:export");
      const after = decodeCursor(f.cursor, cursorSchema);
      const rows = (await db.query<Row>(`SELECT ${COLS} FROM export_jobs WHERE workspace_id = $1 AND ($2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3::uuid)) ORDER BY created_at DESC, id DESC LIMIT $4`, [workspaceId, after?.createdAt ?? null, after?.id ?? null, f.limit + 1])).rows;
      const p = page(rows, f.limit, (r) => ({ createdAt: r.created_at, id: r.id }));
      return { items: p.items.map(view), nextCursor: p.nextCursor };
    },
    async get(a: Actor, workspaceId: string, id: string) {
      await workspaces.authorize(a.id, workspaceId, "reports:export");
      const r = (await db.query<Row>(`SELECT ${COLS} FROM export_jobs WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rows[0];
      if (!r) throw notFound("Report");
      return view(r);
    },
    async download(a: Actor, workspaceId: string, id: string) {
      await workspaces.authorize(a.id, workspaceId, "reports:export");
      const r = (await db.query<Row & { result_csv: string | null; result_b64: string | null }>(`SELECT ${COLS}, result_csv, result_b64 FROM export_jobs WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rows[0];
      if (!r) throw notFound("Report");
      if (r.status !== "done") throw new AppError(409, "REPORT_NOT_READY", `Report is ${r.status}`);
      if (new Date(r.expires_at) < new Date()) throw new AppError(410, "REPORT_EXPIRED", "This export has expired; request a new one");
      await auditRepository.record(db, { workspaceId, actorId: a.id, action: "report.downloaded", entityType: "export", entityId: id, ...(a.requestId ? { requestId: a.requestId } : {}) });
      return r.format === "pdf"
        ? { filename: `${r.type}-${r.params.from}_${r.params.to}.pdf`, contentType: "application/pdf", body: Buffer.from(r.result_b64 ?? "", "base64") }
        : { filename: `${r.type}-${r.params.from}_${r.params.to}.csv`, contentType: "text/csv; charset=utf-8", body: Buffer.from(r.result_csv ?? "", "utf8") };
    },

    // ---- background
    /** Produces queued exports. Each runs in isolation; a failure marks only that export failed (with a safe message). */
    async sweep(limit = 3) {
      const claimed = (await db.tx(async (q) => q.query<Row & { workspace_id: string }>(
        `UPDATE export_jobs SET status = 'running' WHERE id IN (SELECT id FROM export_jobs WHERE status = 'queued' OR (status = 'running' AND created_at < now() - interval '15 minutes') ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED) RETURNING ${COLS}, workspace_id`, [limit]))).rows;
      let done = 0;
      for (const j of claimed) {
        try {
          const t = await generate(j.type as ReportType, j.workspace_id, j.params, { db, analytics: deps.analytics });
          const max = j.format === "pdf" ? PDF_MAX_ROWS : MAX_ROWS;
          if (t.rows.length > max) throw new AppError(422, "TOO_MANY_ROWS", `The export has more than ${max} rows; narrow the date range or filters${j.format === "pdf" ? " (or use CSV)" : ""}`);
          const title = `${j.type.replace(/_/g, " ")} (${j.params.from} to ${j.params.to})`;
          await db.query("UPDATE export_jobs SET status = 'done', row_count = $2, result_csv = $3, result_b64 = $4, finished_at = now(), error = NULL WHERE id = $1",
            [j.id, t.rows.length, j.format === "csv" ? toCsv(t.header, t.rows) : null, j.format === "pdf" ? toPdf(title, `Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC. Empty cells mean the value was not available.`, t.header, t.rows).toString("base64") : null]);
          done++;
        } catch (e) {
          deps.log.error({ err: e, exportId: j.id }, "report generation failed");
          await db.query("UPDATE export_jobs SET status = 'failed', error = $2, finished_at = now() WHERE id = $1", [j.id, e instanceof AppError ? e.message : "The report could not be generated"]);
        }
      }
      return { claimed: claimed.length, done };
    },
    async purgeExpired() { return (await db.query("DELETE FROM export_jobs WHERE expires_at < now()")).rowCount; },
  };
}
export type ReportService = ReturnType<typeof createReportService>;
