import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  CORS_ORIGINS: z.string().default("").transform((s) => s.split(",").map((o) => o.trim()).filter(Boolean)),
  // Secrets (wrangler secret put). Required from the phase that first uses them.
  TOKEN_ENC_KEYS: z.string().optional(), // "<id>:<base64 32B>,<oldid>:<base64 32B>"; first entry encrypts
  BETTER_AUTH_SECRET: z.string().optional(),
  BETTER_AUTH_URL: z.string().url().optional(),
  APP_URL: z.string().url().optional(), // frontend base URL used in emailed links
  LINKEDIN_CLIENT_ID: z.string().optional(),
  LINKEDIN_CLIENT_SECRET: z.string().optional(),
  X_CLIENT_ID: z.string().optional(),
  X_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),   // YouTube
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  INSTAGRAM_APP_ID: z.string().optional(),   // Instagram App ID (not the Facebook app id)
  INSTAGRAM_APP_SECRET: z.string().optional(),
  INSTAGRAM_WEBHOOK_VERIFY_TOKEN: z.string().min(16).optional(),   // the 'Verify Token' configured for Instagram webhooks in the Meta dashboard
  THREADS_APP_ID: z.string().optional(),     // Threads app id (Meta app > Threads use case)
  THREADS_APP_SECRET: z.string().optional(),
  FACEBOOK_APP_ID: z.string().optional(),    // Facebook Login app for Pages publishing
  FACEBOOK_APP_SECRET: z.string().optional(),
  PINTEREST_APP_ID: z.string().optional(),
  PINTEREST_APP_SECRET: z.string().optional(),
  TIKTOK_CLIENT_KEY: z.string().optional(),
  TIKTOK_CLIENT_SECRET: z.string().optional(),
  BLUESKY_SERVICE: z.string().url().optional(), // PDS base URL; default https://bsky.social
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  OPS_TOKEN: z.string().min(24).optional(),   // enables GET /health/queues for external monitoring
  DODO_API_KEY: z.string().min(10).optional(),          // enables billing checkout/cancel (secret: never logged)
  DODO_WEBHOOK_KEY: z.string().min(10).optional(),      // Standard Webhooks signing secret (whsec_...)
  REQUIRE_EMAIL_VERIFICATION: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),   // true = sign-in is refused until the address is verified (verification mail is sent on sign-up either way)
  MEDIA_TRANSFORM_ORIGIN: z.string().url().optional(),   // a zone with Cloudflare Media Transformations enabled (https://<zone>): turns on video re-encoding/downscaling
  NOTIFY_PRODUCER_LAG_S: z.coerce.number().int().min(0).max(86400).default(30),   // events younger than this are not read yet: ids become visible in commit order, and the cursor must not pass a still-open transaction's id
  BILLING_ENFORCE: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),   // plan limits on REST (accounts, seats, posts). MCP always requires its entitlement.
  DODO_MODE: z.enum(["test", "live"]).default("test"),
  ANTHROPIC_API_KEY: z.string().optional(),     // optional: enables AI suggestions
  AI_MODEL: z.string().default("claude-haiku-5-5"),
  AI_DAILY_LIMIT: z.coerce.number().int().min(1).default(200),
  RESEND_API_KEY: z.string().optional(),
});

export type Config = z.infer<typeof schema>;

/** Parses only plain string vars/secrets; bindings (Hyperdrive, Queues, R2) are read separately. */
export function loadConfig(env: Record<string, unknown>): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) throw new Error(`Invalid environment: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`);
  return parsed.data;
}
