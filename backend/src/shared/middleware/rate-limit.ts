import type { Request, RequestHandler } from "express";
import type { Db } from "../../infrastructure/database/db.js";
import type { Logger } from "../../infrastructure/logger/logger.js";

/**
 * Fixed-window limiter backed by Postgres (works across Workers isolates; one atomic upsert per limited request).
 * It is a second line behind Cloudflare edge rate limiting / WAF, meant for sensitive endpoints, keyed by user (or client IP).
 * If the database cannot be reached the limiter FAILS OPEN (and logs): an outage must not turn into a second outage.
 */
export function createRateLimiter(db: Db, log: Logger, now: () => number = Date.now) {
  return (o: { name: string; limit: number; windowS: number; key?: (req: Request) => string | undefined }): RequestHandler => async (req, res, next) => {
    try {
      const identity = o.key?.(req) ?? req.user?.id ?? clientIp(req);
      const nowS = Math.floor(now() / 1000), window = nowS - (nowS % o.windowS);
      const r = await db.query<{ count: number }>(
        `INSERT INTO rate_limits (key, window_start, count) VALUES ($1,$2,1)
         ON CONFLICT (key) DO UPDATE SET count = CASE WHEN rate_limits.window_start = EXCLUDED.window_start THEN rate_limits.count + 1 ELSE 1 END, window_start = EXCLUDED.window_start
         RETURNING count`, [`${o.name}:${identity}`, window]);
      const count = r.rows[0]!.count;
      res.setHeader("RateLimit-Limit", String(o.limit));
      res.setHeader("RateLimit-Remaining", String(Math.max(0, o.limit - count)));
      if (count > o.limit) {
        const retry = window + o.windowS - nowS;
        res.setHeader("Retry-After", String(retry));
        res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many requests", details: { retryAfterSeconds: retry }, requestId: req.id } });
        return;
      }
    } catch (err) {
      log.error({ err, limiter: o.name }, "rate limiter unavailable; allowing request");
    }
    next();
  };
}
export const clientIp = (req: Request) => req.header("cf-connecting-ip") ?? req.ip ?? "unknown";
