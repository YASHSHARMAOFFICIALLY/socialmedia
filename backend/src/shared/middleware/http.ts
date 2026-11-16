import type { ErrorRequestHandler, Request, RequestHandler } from "express";
import { ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { AppError } from "../errors/errors.js";
import type { Logger } from "../../infrastructure/logger/logger.js";

// Consistent envelopes: { data, meta? } on success, { error: { code, message, details?, requestId } } on failure.
export const requestId: RequestHandler = (req, res, next) => {
  const inbound = req.header("x-request-id");
  const id = inbound && /^[\w-]{8,64}$/.test(inbound) ? inbound : randomUUID();
  req.id = id;
  res.setHeader("x-request-id", id);
  next();
};

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found", requestId: req.id } });
};

export const errorHandler = (log: Logger, onUnhandled?: (req: Request, err: unknown) => void): ErrorRequestHandler => (err, req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid input", details: err.flatten(), requestId: req.id } });
    return;
  }
  // body-parser errors carry an HTTP status and a type; they are client errors, not server errors
  const bp = err as { type?: string; status?: number };
  if (bp.type === "entity.too.large") { res.status(413).json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Request body is too large", requestId: req.id } }); return; }
  if (bp.type === "entity.parse.failed" || bp.type === "encoding.unsupported" || bp.type === "charset.unsupported") { res.status(400).json({ error: { code: "BAD_REQUEST", message: "Malformed request body", requestId: req.id } }); return; }
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details, requestId: req.id } });
    return;
  }
  log.error({ err, requestId: req.id }, "unhandled error");
  onUnhandled?.(req, err);
  res.status(500).json({ error: { code: "INTERNAL", message: "Internal server error", requestId: req.id } });
};
