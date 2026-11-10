import type { RequestHandler } from "express";
import type { ZodType } from "zod";

/** Parses and REPLACES body/query/params with the validated values. Errors become VALIDATION_ERROR via errorHandler. */
export const validate = (s: { body?: ZodType; query?: ZodType; params?: ZodType }): RequestHandler => (req, _res, next) => {
  try {
    if (s.params) Object.defineProperty(req, "params", { value: s.params.parse(req.params), writable: true });
    if (s.query) Object.defineProperty(req, "query", { value: s.query.parse(req.query), writable: true });
    if (s.body) req.body = s.body.parse(req.body);
    next();
  } catch (e) {
    next(e);
  }
};
