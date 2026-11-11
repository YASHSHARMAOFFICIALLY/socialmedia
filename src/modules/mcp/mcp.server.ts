import { McpServer } from "@modelcontextprotocol/server";
import { auditCall, guard, toErrorResult } from "./mcp.guard.js";
import type { McpDeps } from "./mcp.deps.js";
import { registerPrompts } from "./mcp.prompts.js";
import { registerResources } from "./mcp.resources.js";
import { analyticsTools } from "./mcp.tools.analytics.js";
import { contentTools } from "./mcp.tools.content.js";
import { billingTools } from "./mcp.tools.billing.js";
import type { Principal, ToolDef } from "./mcp.types.js";

/** Add a tool here (or in a new tools file listed here); nothing else in the server changes. */
export const TOOLS: ToolDef[] = [...analyticsTools, ...contentTools, ...billingTools];

/** One server per request/caller. Holds no state: safe for concurrent customers on any number of Worker isolates. */
export function buildMcpServer(deps: McpDeps, principal: Principal): McpServer {
  const server = new McpServer({ name: "distora", version: "1.0.0" });
  for (const def of TOOLS) {
    server.registerTool(def.name, { title: def.title, description: def.description, inputSchema: def.input, annotations: { readOnlyHint: def.readOnly !== false, destructiveHint: false, openWorldHint: false } }, async (args: Record<string, unknown>) => {
      let ws: string | null = null;
      try {
        const c = await guard(deps, principal, def.scope, args["workspaceId"] as string | undefined, def.gated !== false);
        ws = c.workspaceId;
        const data = await def.handler(c, args as never);
        await auditCall(deps, principal, "tool_call", def.name, ws, "ok");
        const structured = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;   // plain JSON only
        return { content: [{ type: "text" as const, text: JSON.stringify(structured) }], structuredContent: structured };
      } catch (e) {
        await auditCall(deps, principal, "tool_call", def.name, ws, e instanceof Error && "code" in e ? String((e as { code: unknown }).code) : "error");
        return toErrorResult(deps, e);
      }
    });
  }
  registerResources(server, deps, principal);
  registerPrompts(server, deps, principal);
  return server;
}
