import { AppError, forbidden } from "../../shared/errors/errors.js";
import { auditRepository } from "../audit/audit.repository.js";
import type { McpDeps } from "./mcp.deps.js";
import type { Principal, ToolCtx } from "./mcp.types.js";

/**
 * The single gate every tool, resource and prompt passes through, in this order:
 *  1. token scope  2. workspace (never trusted from the caller: token binding + real membership)  3. plan entitlement (mcp_access).
 * Membership is checked BEFORE the entitlement so another tenant's plan is never revealed.
 */
export async function guard(deps: McpDeps, p: Principal, scope: string, workspaceArg: string | undefined, gated = true): Promise<ToolCtx> {
  if (!p.scopes.includes(scope)) throw new AppError(403, "INSUFFICIENT_SCOPE", `This connection was not granted the '${scope}' scope`);
  let ws = workspaceArg ?? p.workspaceId;
  if (p.workspaceId && ws !== p.workspaceId) throw forbidden();                       // a workspace-bound token can never reach another workspace
  if (!ws) {
    const mine = (await deps.db.query<{ workspace_id: string }>("SELECT workspace_id FROM workspace_members WHERE user_id = $1 LIMIT 2", [p.userId])).rows;
    if (mine.length !== 1) throw new AppError(400, "WORKSPACE_REQUIRED", mine.length ? "You belong to several workspaces: pass workspaceId" : "You do not belong to any workspace");
    ws = mine[0]!.workspace_id;
  }
  await deps.workspaces.authorize(p.userId, ws, "workspace:read");                      // 404 for non-members
  if (gated) await deps.billing.enforce(ws, "mcp_access");                              // 402 PLAN_LIMIT_REACHED on plans without MCP
  return { principal: p, actor: { id: p.userId, email: p.email }, workspaceId: ws, deps };
}

/** Metadata only: never arguments or results (they can contain third-party text and business data). */
export async function auditCall(deps: McpDeps, p: Principal, kind: string, name: string, workspaceId: string | null, outcome: string) {
  await auditRepository.record(deps.db, { workspaceId, actorId: p.userId, action: `mcp.${kind}`, entityType: "mcp", entityId: name, metadata: { outcome, ...(p.clientId ? { clientId: p.clientId } : {}) } })
    .catch((err) => deps.log.warn({ err }, "mcp audit failed"));
}

export function toErrorResult(deps: McpDeps, e: unknown) {
  const known = e instanceof AppError;
  if (!known) deps.log.error({ err: e }, "mcp tool failed");
  const body = known ? { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } : { code: "INTERNAL_ERROR", message: "Something went wrong" };
  return { isError: true as const, content: [{ type: "text" as const, text: JSON.stringify({ error: body }) }], structuredContent: { error: body } };
}
