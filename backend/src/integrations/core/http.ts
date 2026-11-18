import { classifyHttp, markCreating, PlatformError, retryAfterSeconds, secondsUntilEpoch, type PlatformErrorKind } from "./errors.js";

export interface ApiOpts {
  /** The request that creates the post: an ambiguous failure is "unknown" (reconcile), never "retryable" (resend = duplicate). */
  creates?: boolean;
  /** Platform-specific classification from the error body; return undefined to fall back to the HTTP status. */
  classify?: (status: number, body: unknown) => PlatformErrorKind | undefined;
}

const pick = (b: unknown): string => {
  if (!b || typeof b !== "object") return "";
  const o = b as Record<string, unknown>;
  const v = o.error_description ?? o.description ?? o.message ?? o.error ?? (o.error as { message?: unknown } | undefined)?.message;
  return typeof v === "string" ? `: ${v.slice(0, 200)}` : "";
};

/** fetch + error classification that reads the error body (platformFetch only sees the status). Never includes request data in the message. */
export async function apiFetch(f: typeof fetch, platform: string, url: string, init: RequestInit = {}, opts: ApiOpts = {}): Promise<Response> {
  if (opts.creates) markCreating(init.signal);
  let res: Response;
  try {
    res = await f(url, init);
  } catch (e) {
    throw new PlatformError(opts.creates ? "unknown" : "retryable", `${platform} request failed: ${(e as Error).message}`);
  }
  if (res.ok) return res;
  const body = await res.json().catch(() => null);
  const kind = opts.classify?.(res.status, body) ?? (opts.creates && res.status >= 500 ? "unknown" : classifyHttp(res.status));
  const inBody = (body as { parameters?: { retry_after?: number } } | null)?.parameters?.retry_after;
  const retryAfterS = retryAfterSeconds(res.headers.get("retry-after")) ?? secondsUntilEpoch(res.headers.get("ratelimit-reset")) ?? (typeof inBody === "number" ? inBody : undefined);
  throw new PlatformError(kind, `${platform} responded ${res.status}${pick(body)}`, { status: res.status, ...(retryAfterS !== undefined ? { retryAfterS } : {}) });
}

/** Meta Graph error codes: 190 = invalid/expired token; 4, 17, 32, 613 = rate limits. */
export const metaClassify: NonNullable<ApiOpts["classify"]> = (_status, body) => {
  const code = (body as { error?: { code?: number } } | null)?.error?.code;
  if (code === 190) return "auth_expired";
  if (code === 4 || code === 17 || code === 32 || code === 613) return "rate_limited";
  return undefined;
};
export const metaFetch = (f: typeof fetch, platform: string, url: string, init: RequestInit = {}, opts: ApiOpts = {}) => apiFetch(f, platform, url, init, { classify: metaClassify, ...opts });
