import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

/** What we keep per login. Secrets never go to stdout or logs. */
export interface Credentials { apiUrl: string; accessToken: string; refreshToken?: string; expiresAt?: number; workspaceId?: string; scope?: string }

const SERVICE = "distora-mcp", ACCOUNT = "default";
const dir = () => process.env["DISTORA_CONFIG_DIR"] ?? join(process.env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config"), "distora");
const file = () => join(dir(), "credentials.json");

interface Backend { name: string; read(): string | null; write(v: string): void; remove(): void }

/**
 * macOS Keychain via `security -i`: commands are read from stdin, so the secret never appears in argv (`ps` shows argv to every local user).
 * The value is stored base64-encoded so it needs no shell/keychain quoting; legacy raw-JSON entries are still read.
 */
const macKeychain: Backend = {
  name: "macOS Keychain",
  read: () => { try { const v = execFileSync("security", ["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); return v.startsWith("{") ? v : Buffer.from(v, "base64").toString("utf8"); } catch { return null; } },
  write: (v) => { const r = spawnSync("security", ["-i"], { input: `add-generic-password -U -s ${SERVICE} -a ${ACCOUNT} -w ${Buffer.from(v).toString("base64")}\n`, stdio: ["pipe", "ignore", "ignore"] }); if (r.status !== 0) throw new Error("security failed"); },
  remove: () => { try { execFileSync("security", ["delete-generic-password", "-s", SERVICE, "-a", ACCOUNT], { stdio: "ignore" }); } catch { /* not there */ } },
};
/** Linux Secret Service via libsecret's `secret-tool`; the secret goes over stdin, never argv. */
const secretService: Backend = {
  name: "Secret Service",
  read: () => { const r = spawnSync("secret-tool", ["lookup", "service", SERVICE, "account", ACCOUNT], { encoding: "utf8" }); return r.status === 0 && r.stdout ? r.stdout : null; },
  write: (v) => { const r = spawnSync("secret-tool", ["store", "--label=Distora MCP", "service", SERVICE, "account", ACCOUNT], { input: v }); if (r.status !== 0) throw new Error("secret-tool failed"); },
  remove: () => { spawnSync("secret-tool", ["clear", "service", SERVICE, "account", ACCOUNT]); },
};
/** Last resort: a 0600 file in the user's config directory. */
const fileStore: Backend = {
  name: "file (0600)",
  read: () => (existsSync(file()) ? readFileSync(file(), "utf8") : null),
  write: (v) => { mkdirSync(dir(), { recursive: true, mode: 0o700 }); writeFileSync(file(), v, { mode: 0o600 }); chmodSync(file(), 0o600); },
  remove: () => rmSync(file(), { force: true }),
};
const hasTool = (cmd: string) => spawnSync(cmd, ["--version"], { stdio: "ignore" }).error === undefined || spawnSync("which", [cmd], { stdio: "ignore" }).status === 0;

export function pickBackend(): Backend {
  if (process.env["DISTORA_CONFIG_DIR"]) return fileStore;                       // explicit directory (tests, containers)
  if (platform() === "darwin") return macKeychain;
  if (platform() === "linux" && hasTool("secret-tool")) return secretService;
  return fileStore;
}

export const store = {
  backendName: () => pickBackend().name,
  load(): Credentials | null {
    const raw = pickBackend().read() ?? (pickBackend().name === fileStore.name ? null : fileStore.read());
    if (!raw) return null;
    try { const c = JSON.parse(raw) as Credentials; return typeof c.apiUrl === "string" && typeof c.accessToken === "string" ? c : null; } catch { return null; }
  },
  save(c: Credentials) { pickBackend().write(JSON.stringify(c)); },
  clear() { pickBackend().remove(); fileStore.remove(); },
};
