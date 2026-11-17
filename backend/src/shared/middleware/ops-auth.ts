import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

const eq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };   // compare BYTE lengths: non-ASCII input must not throw

/** Operator-only routes: `Authorization: Bearer <token>` matching any configured token, compared in constant time. 404 when none is configured. */
export const opsAuth = (...tokens: (string | undefined)[]): RequestHandler => (req, res, next) => {
  const valid = tokens.filter((t): t is string => !!t);
  if (valid.length === 0) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found", requestId: req.id } }); return; }
  const given = /^Bearer (.+)$/.exec(req.header("authorization") ?? "")?.[1] ?? "";
  if (!valid.map((t) => eq(given, t)).includes(true)) { res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Authentication required", requestId: req.id } }); return; }   // no early exit: don't leak which token matched
  next();
};
