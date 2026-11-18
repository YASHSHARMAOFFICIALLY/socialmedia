#!/usr/bin/env node
import { spawn } from "node:child_process";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { ApiError, authedFetch, normalizeApiUrl, pollDevice, startDevice } from "./api.js";
import { createProxyServer } from "./proxy.js";
import { store, type Credentials } from "./store.js";

// stdout is the MCP protocol channel while serving: EVERYTHING human-readable goes to stderr.
const say = (s: string) => process.stderr.write(`${s}\n`);

function openBrowser(url: string) {
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]] : ["xdg-open", [url]];
  try { spawn(cmd as string, args as string[], { stdio: "ignore", detached: true }).on("error", () => {}).unref(); } catch { /* the URL is printed anyway */ }
}
const flag = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };

/** Credentials for serving: POSTRALLY_TOKEN (+POSTRALLY_API_URL) for CI/headless, else the stored login. */
function credentials(): Credentials {
  const envToken = process.env["POSTRALLY_TOKEN"];
  if (envToken) return { apiUrl: normalizeApiUrl(process.env["POSTRALLY_API_URL"] ?? ""), accessToken: envToken };
  const c = store.load();
  if (!c) throw new ApiError("not_logged_in", "Not logged in. Run `postrally mcp login --api-url https://<your-api>`");
  return c;
}

async function login() {
  const apiUrl = normalizeApiUrl(flag("--api-url") ?? process.env["POSTRALLY_API_URL"] ?? "");
  const d = await startDevice(apiUrl, "postrally-cli");
  say(`Open ${d.verification_uri}\nand enter the code ${d.user_code}. Waiting for approval...`);
  // Only auto-open a link on the API's own origin: a hostile --api-url must not make us launch arbitrary strings.
  let sameOrigin = false;
  try { sameOrigin = new URL(d.verification_uri).origin === apiUrl; } catch { /* printed above */ }
  if (sameOrigin) openBrowser(d.verification_uri);
  const creds = await pollDevice(apiUrl, d);
  store.save(creds);
  say(`Logged in (credentials stored in ${store.backendName()}).`);
}

async function serve() {
  const creds = credentials();
  const client = new Client({ name: "postrally-cli", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${creds.apiUrl}/mcp`), { fetch: authedFetch(creds) }));
  const proxy = await createProxyServer(client);
  const handle = serveStdio(() => proxy);
  say("postrally MCP bridge ready on stdio");
  const stop = () => { void handle.close().then(() => client.close()).finally(() => process.exit(0)); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
}

async function status() {
  const c = process.env["POSTRALLY_TOKEN"] ? credentials() : store.load();
  if (!c) { say("Not logged in."); process.exitCode = 1; return; }
  say(`Logged in to ${c.apiUrl}${c.workspaceId ? ` (workspace ${c.workspaceId})` : ""}; scopes: ${c.scope ?? "token"}; stored in ${process.env["POSTRALLY_TOKEN"] ? "environment" : store.backendName()}.`);
}

async function main() {
  const [, , group, cmd] = process.argv;
  if (group !== "mcp" || !["login", "logout", "status", "serve"].includes(cmd ?? "")) { say("Usage: postrally mcp <login [--api-url URL] | logout | status | serve>"); process.exitCode = 2; return; }
  if (cmd === "login") await login();
  else if (cmd === "logout") { store.clear(); say("Logged out."); }
  else if (cmd === "status") await status();
  else await serve();
}
main().catch((e) => { say(e instanceof ApiError ? e.message : "Unexpected error"); process.exitCode = 1; });
