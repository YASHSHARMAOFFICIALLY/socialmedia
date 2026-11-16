import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

const eq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };   // compare BYTE lengths: non-ASCII input must not throw

/** Operator-only routes: `Authorization: Bearer <OPS_TOKEN>`, compared in constant time. 404 when no token is configured. */
export const opsAuth = (opsToken: string | undefined): RequestHandler => (req, res, next) => {
  if (!opsToken) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found", requestId: req.id } }); return; }
  const given = /^Bearer (.+)$/.exec(req.header("authorization") ?? "")?.[1] ?? "";
  if (!eq(given, opsToken)) { res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Authentication required", requestId: req.id } }); return; }
  next();
};
