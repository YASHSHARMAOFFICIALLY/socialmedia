import { Client } from "@modelcontextprotocol/client";
import { fromJsonSchema, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

type Remote = Pick<Client, "listTools" | "callTool" | "listResources" | "readResource" | "listPrompts" | "getPrompt">;

/**
 * Builds a local MCP server whose tools, resources and prompts are exactly the remote server's.
 * It adds no logic of its own: every call is forwarded, so entitlements, scopes and workspace checks stay server-side.
 */
export async function createProxyServer(remote: Remote): Promise<McpServer> {
  const server = new McpServer({ name: "postrally", version: "1.0.0" });
  for (const t of (await remote.listTools()).tools) {
    server.registerTool(t.name, { ...(t.title ? { title: t.title } : {}), description: t.description ?? "", inputSchema: fromJsonSchema(t.inputSchema as never), ...(t.annotations ? { annotations: t.annotations } : {}) },
      (async (args: Record<string, unknown>) => remote.callTool({ name: t.name, arguments: args })) as never);
  }
  for (const r of (await remote.listResources()).resources) {
    server.registerResource(r.name, r.uri, { ...(r.title ? { title: r.title } : {}), ...(r.description ? { description: r.description } : {}), mimeType: r.mimeType ?? "application/json" },
      async (u: URL) => ({ contents: (await remote.readResource({ uri: u.href })).contents }) as never);
  }
  for (const p of (await remote.listPrompts()).prompts) {
    const shape = Object.fromEntries((p.arguments ?? []).map((a) => [a.name, a.required ? z.string() : z.string().optional()]));
    server.registerPrompt(p.name, { ...(p.title ? { title: p.title } : {}), ...(p.description ? { description: p.description } : {}), argsSchema: shape },
      (async (args: Record<string, string>) => remote.getPrompt({ name: p.name, arguments: args })) as never);
  }
  return server;
}
