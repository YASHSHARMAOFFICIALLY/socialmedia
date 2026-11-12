import type { RequestHandler } from "express";

/**
 * CSRF defence for cookie-authenticated APIs: a state-changing request that carries an Origin header must come from an allowed origin.
 * (Requests without Origin are non-browser clients, which are not CSRF-able.) Complements SameSite cookies and CORS.
 */
export const originGuard = (allowed: string[], selfOrigin?: string): RequestHandler => (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.header("origin");
  if (!origin || allowed.includes(origin) || origin === selfOrigin) return next();
  res.status(403).json({ error: { code: "ORIGIN_NOT_ALLOWED", message: "Cross-origin request blocked", requestId: req.id } });
};

/** API responses can contain private data: never cache them (the docs page and health checks are exempt). */
export const noStore: RequestHandler = (req, res, next) => {
  if (!req.path.startsWith("/docs") && !req.path.startsWith("/openapi.json")) res.setHeader("Cache-Control", "no-store");
  next();
};
