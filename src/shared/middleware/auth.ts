import type { RequestHandler } from "express";
import { fromNodeHeaders } from "better-auth/node";
import type { Auth } from "../../modules/auth/auth.js";
import { unauthorized } from "../errors/errors.js";

export const requireAuth = (auth: Auth): RequestHandler => async (req, _res, next) => {
  if (req.user) return next();   // already authenticated earlier in this request (e.g. by a rate limiter)
  try {
    const s = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!s) throw unauthorized();
    req.user = { id: s.user.id, email: s.user.email, name: s.user.name };
    next();
  } catch (e) {
    next(e);
  }
};
