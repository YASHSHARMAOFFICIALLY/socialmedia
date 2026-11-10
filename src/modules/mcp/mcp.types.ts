import type { z } from "zod";
import type { Actor } from "../workspaces/workspace.service.js";
import type { McpDeps } from "./mcp.deps.js";

/** Who is calling. Built ONLY from a verified token (remote) — never from tool arguments. */
export interface Principal { userId: string; email: string; scopes: readonly string[]; workspaceId?: string | undefined; clientId?: string | undefined }

/** Scopes a token may carry. Each tool names exactly one. */
export const SCOPES = ["accounts:read", "analytics:read", "content:read", "billing:read", "billing:portal"] as const;

export interface ToolCtx { principal: Principal; actor: Actor; workspaceId: string; deps: McpDeps }

export interface ToolDef<S extends z.ZodObject = z.ZodObject> {
  name: string;
  title: string;
  description: string;
  scope: (typeof SCOPES)[number];
  input: S;
  /** false for tools that must work on any plan (none today). Everything else requires the plan's mcp_access entitlement. */
  gated?: boolean;
  handler(c: ToolCtx, args: z.infer<S>): Promise<unknown>;
}
export const defineTool = <S extends z.ZodObject>(t: ToolDef<S>) => t as unknown as ToolDef;
