/** Every adapter failure is mapped into one of these so the publishing engine can decide retry vs. fail. */
export type PlatformErrorKind = "retryable" | "rate_limited" | "auth_expired" | "permanent" | "unknown";

export class PlatformError extends Error {
  constructor(
    public readonly kind: PlatformErrorKind,
    message: string,
    public readonly opts: { status?: number; retryAfterS?: number; code?: string } = {},
  ) {
    super(message);
  }
}

/**
 * Signals whose creating request has been sent. The engine reads this when its publish timeout fires:
 * before the creating request nothing can exist on the platform (retryable); after it the outcome is unknown.
 */
const creatingSent = new WeakSet<AbortSignal>();
export function markCreating(signal: AbortSignal | null | undefined): void {
  if (!signal) throw new Error("a creating request must carry the publish signal");   // programmer error: caught by tests
  creatingSent.add(signal);
}
export const creatingStarted = (signal: AbortSignal) => creatingSent.has(signal);

/** Default HTTP classification; adapters override for platform-specific codes. */
export function classifyHttp(status: number, retryAfterHeader?: string | null): PlatformErrorKind {
  if (status === 401) return "auth_expired";
  if (status === 429) return "rate_limited";
  if (status === 408 || status >= 500) return "retryable";
  if (status >= 400) return "permanent";
  return "unknown";
}
export const retryAfterSeconds = (h?: string | null) => (h && /^\d+$/.test(h) ? Number(h) : undefined);
/** X reports the reset moment as epoch seconds in x-rate-limit-reset. */
export const secondsUntilEpoch = (h?: string | null, now = Date.now()) => (h && /^\d{9,}$/.test(h) ? Math.max(0, Number(h) - Math.floor(now / 1000)) : undefined);

/**
 * `creates: true` marks the request that actually creates a post. If it fails ambiguously (network error, timeout,
 * 5xx) the post may exist, so the outcome is "unknown" (reconcile) rather than "retryable" (resend = duplicate).
 */
export async function platformFetch(f: typeof fetch, platform: string, url: string, init: RequestInit, opts: { creates?: boolean } = {}): Promise<Response> {
  if (opts.creates) markCreating(init.signal);
  let res: Response;
  try {
    res = await f(url, init);
  } catch (e) {
    throw new PlatformError(opts.creates ? "unknown" : "retryable", `${platform} request failed: ${(e as Error).message}`); // network errors
  }
  if (res.ok) return res;
  throw errorFromResponse(platform, res, opts.creates);
}

/** Builds the classified error for a non-2xx response. */
export function errorFromResponse(platform: string, res: Response, creates = false): PlatformError {
  const retryAfterS = retryAfterSeconds(res.headers.get("retry-after")) ?? secondsUntilEpoch(res.headers.get("x-rate-limit-reset"));
  return new PlatformError(creates && res.status >= 500 ? "unknown" : classifyHttp(res.status), `${platform} responded ${res.status}`, { status: res.status, ...(retryAfterS !== undefined ? { retryAfterS } : {}) });
}
