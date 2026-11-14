import type { z } from "zod";
import type { Actor } from "../workspaces/workspace.service.js";
import type { McpDeps } from "./mcp.deps.js";

/** Who is calling. Built ONLY from a verified token (remote) — never from tool arguments. */
export interface Principal { userId: string; email: string; scopes: readonly string[]; workspaceId?: string | undefined; clientId?: string | undefined }

/** Scopes a token may carry. Each tool names exactly one. */
export const SCOPES = ["accounts:read", "analytics:read", "content:read", "content:write", "content:publish", "billing:read", "billing:portal"] as const;
/** What a client gets when it does not ask for specific scopes: everything read-only. Writing drafts, publishing and the billing portal must be requested explicitly. */
export const DEFAULT_SCOPES = SCOPES.filter((s) => s !== "billing:portal" && s !== "content:write" && s !== "content:publish");

export interface ToolCtx { principal: Principal; actor: Actor; workspaceId: string; deps: McpDeps }

export interface ToolDef<S extends z.ZodObject = z.ZodObject> {
  name: string;
  title: string;
  description: string;
  scope: (typeof SCOPES)[number];
  input: S;
  /** false for tools that must work on any plan (none today). Everything else requires the plan's mcp_access entitlement. */
  gated?: boolean;
  /** false for a tool with side effects (e.g. mints a link, writes an audit row): clients then keep their confirmation prompt. Default true. */
  readOnly?: boolean;
  /** true for a tool whose effect cannot be undone from here (posting to a social network). */
  destructive?: boolean;
  /** true when the tool reaches outside this service (third-party platforms). */
  openWorld?: boolean;
  handler(c: ToolCtx, args: z.infer<S>): Promise<unknown>;
}
export const defineTool = <S extends z.ZodObject>(t: ToolDef<S>) => t as unknown as ToolDef;
