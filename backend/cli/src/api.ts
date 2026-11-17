import { store, type Credentials } from "./store.js";

export class ApiError extends Error { constructor(public readonly code: string, message: string) { super(message); } }

/** https only (localhost may use http for development). The URL is never taken from a server response. */
export function normalizeApiUrl(raw: string): string {
  let u: URL;
  try { u = new URL(raw); } catch { throw new ApiError("bad_url", "Invalid --api-url"); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (u.protocol !== "https:" && !(local && u.protocol === "http:")) throw new ApiError("bad_url", "The API URL must use https");
  return u.origin;
}

async function post(apiUrl: string, path: string, body: Record<string, string | string[]>, f: typeof fetch = fetch) {
  const form = path === "/mcp/token";
  const res = await f(`${apiUrl}${path}`, { method: "POST", headers: { "content-type": form ? "application/x-www-form-urlencoded" : "application/json" }, body: form ? new URLSearchParams(body as Record<string, string>).toString() : JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

export interface DeviceStart { device_code: string; user_code: string; verification_uri: string; verification_uri_complete: string; expires_in: number; interval: number }
export const startDevice = async (apiUrl: string, clientName: string, f?: typeof fetch): Promise<DeviceStart> => {
  const r = await post(apiUrl, "/mcp/device", { client_name: clientName }, f);
  if (r.status !== 200) throw new ApiError("start_failed", `Could not start login (HTTP ${r.status})`);
  return r.json as unknown as DeviceStart;
};

const toCreds = (apiUrl: string, j: Record<string, unknown>, now: number): Credentials => ({
  apiUrl, accessToken: String(j["access_token"]), ...(j["refresh_token"] ? { refreshToken: String(j["refresh_token"]) } : {}),
  expiresAt: now + Number(j["expires_in"] ?? 3600) * 1000, ...(j["workspace_id"] ? { workspaceId: String(j["workspace_id"]) } : {}), ...(j["scope"] ? { scope: String(j["scope"]) } : {}),
});

/** Polls until approved, denied or expired. Honors authorization_pending / slow_down. */
export async function pollDevice(apiUrl: string, d: DeviceStart, o: { f?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => number } = {}): Promise<Credentials> {
  const sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))), now = o.now ?? Date.now;
  let interval = d.interval * 1000;
  const deadline = now() + d.expires_in * 1000;
  while (now() < deadline) {
    await sleep(interval);
    const r = await post(apiUrl, "/mcp/token", { grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: d.device_code }, o.f);
    if (r.status === 200) return toCreds(apiUrl, r.json, now());
    const err = String(r.json["error"] ?? "");
    if (err === "authorization_pending") continue;
    if (err === "slow_down") { interval += 5000; continue; }
    throw new ApiError(err || "login_failed", err === "access_denied" ? "Login was denied" : err === "expired_token" ? "The code expired; run login again" : "Login failed");
  }
  throw new ApiError("expired_token", "The code expired; run login again");
}

/**
 * Rotating refresh: the old refresh token is dead after this call, so the result is saved before anything else happens.
 * Several `serve` processes can share one login: adopt tokens another process already rotated instead of replaying a dead one,
 * and only wipe the store when the server says the grant is gone (a 429/5xx must not log the user out).
 */
export async function refresh(c: Credentials, f?: typeof fetch, now = Date.now()): Promise<Credentials> {
  if (!c.refreshToken) throw new ApiError("no_refresh", "Session expired; run `postrally mcp login`");
  const newer = () => { const s = store.load(); return s?.refreshToken && s.refreshToken !== c.refreshToken ? s : null; };
  const adopted = newer();
  if (adopted?.expiresAt && adopted.expiresAt - now > 60_000) return adopted;
  const r = await post(c.apiUrl, "/mcp/token", { grant_type: "refresh_token", refresh_token: (adopted ?? c).refreshToken! }, f);
  if (r.status === 200) {
    const next = toCreds(c.apiUrl, r.json, now);
    store.save(next);
    return next;
  }
  if (r.json["error"] === "invalid_grant") {
    const raced = newer();     // lost a race with another process that has saved newer tokens since
    if (raced) return raced;
    store.clear();
    throw new ApiError("invalid_grant", "Session ended; run `postrally mcp login`");
  }
  throw new ApiError("refresh_failed", "Could not refresh the session right now; try again shortly");
}

/** A fetch that always sends a fresh bearer token (refreshing 60s early), for the MCP client transport. */
export function authedFetch(initial: Credentials, f: typeof fetch = fetch): typeof fetch {
  let creds = initial, inflight: Promise<Credentials> | null = null;
  const fresh = async () => {
    if (creds.refreshToken && creds.expiresAt && creds.expiresAt - Date.now() < 60_000) inflight ??= refresh(creds, f).then((n) => (creds = n)).finally(() => { inflight = null; });
    if (inflight) await inflight;
    return creds;
  };
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const c = await fresh();
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${c.accessToken}`);
    return f(url, { ...init, headers });
  }) as typeof fetch;
}
