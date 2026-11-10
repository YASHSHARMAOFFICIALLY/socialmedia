import pino from "pino";
import type { Config } from "../../config/env.js";

// Redact secrets everywhere; never log tokens.
export const redactPaths = [
  "req.headers.authorization", "req.headers.cookie", "res.headers['set-cookie']",
  "*.accessToken", "*.refreshToken", "*.access_token", "*.refresh_token", "*.password",
  // payments + MCP: provider keys, webhook signing keys/signatures, device codes, bearer/personal tokens, card data (never stored, never logged)
  "*.apiKey", "*.webhookKey", "*.token", "*.device_code", "*.client_secret", "*.cardNumber", "*.cvv", "*.card_number",
  "req.headers['webhook-signature']", "req.headers['x-hub-signature-256']",
];

export function createLogger(cfg: Pick<Config, "LOG_LEVEL">) {
  return pino({
    level: cfg.LOG_LEVEL,
    redact: { paths: redactPaths, censor: "[REDACTED]" },
    // Workers bundle pino's browser build: route JSON lines to console (Workers Logs picks them up).
    browser: { asObject: true, write: (o) => console.log(JSON.stringify(o)) },
  });
}
export type Logger = pino.Logger;
