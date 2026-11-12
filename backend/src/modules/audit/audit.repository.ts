import type { Queryable } from "../../infrastructure/database/db.js";

export interface AuditEntry {
  workspaceId: string | null;
  actorId: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  requestId?: string;
}

export const auditRepository = {
  record: (q: Queryable, e: AuditEntry) =>
    q.query(
      "INSERT INTO audit_logs (workspace_id, actor_id, action, entity_type, entity_id, metadata, request_id) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [e.workspaceId, e.actorId, e.action, e.entityType ?? null, e.entityId ?? null, JSON.stringify(e.metadata ?? {}), e.requestId ?? null],
    ),
  list: (q: Queryable, workspaceId: string, limit: number, before?: number) =>
    q.query<{ id: string; actor_id: string | null; action: string; entity_type: string | null; entity_id: string | null; metadata: unknown; created_at: string }>(
      `SELECT id::text, actor_id, action, entity_type, entity_id, metadata, created_at
         FROM audit_logs WHERE workspace_id = $1 AND ($2::bigint IS NULL OR id < $2) ORDER BY id DESC LIMIT $3`,
      [workspaceId, before ?? null, limit + 1],
    ),
};
