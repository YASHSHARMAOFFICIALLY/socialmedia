import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins";
import { PostgresDialect } from "kysely";
import type { Config } from "../../config/env.js";
import type { Db } from "../../infrastructure/database/db.js";
import type { Mailer } from "../../infrastructure/email/resend.js";

/** Kysely (used by Better Auth) talks to Postgres through our Db, so Workers/Node/PGlite all work. */
const dialect = (db: Db) =>
  new PostgresDialect({
    pool: {
      connect: async () => {
        const s = await db.session();
        return {
          query: async (sql: string, params?: readonly unknown[]) => {
            const r = await s.query(sql, params);
            return { rows: r.rows, rowCount: r.rowCount, command: r.command ?? "" };
          },
          release: () => void s.release(),
        };
      },
      end: async () => {},
    } as never,
  });

export function createAuth(db: Db, cfg: Config, mailer: Mailer) {
  if (!cfg.BETTER_AUTH_SECRET) throw new Error("BETTER_AUTH_SECRET is required");
  return betterAuth({
    secret: cfg.BETTER_AUTH_SECRET,
    ...(cfg.BETTER_AUTH_URL ? { baseURL: cfg.BETTER_AUTH_URL } : {}),
    trustedOrigins: cfg.CORS_ORIGINS,
    database: { dialect: dialect(db), type: "postgres" },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      requireEmailVerification: cfg.REQUIRE_EMAIL_VERIFICATION,
      sendResetPassword: async ({ user, url }) => {
        await mailer.send({ to: user.email, subject: "Reset your password", html: `<p><a href="${url}">Reset password</a> (expires soon)</p>` });
      },
    },
    emailVerification: {
      sendOnSignUp: true, autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => { await mailer.send({ to: user.email, subject: "Verify your email", html: `<p><a href="${url}">Verify your email address</a></p>` }); },
    },
    // Google sign-in reuses the Google OAuth client (also used for YouTube); it is only on when both are set.
    // The client must allow ${BETTER_AUTH_URL}/api/auth/callback/google as a redirect URI.
    ...(cfg.GOOGLE_CLIENT_ID && cfg.GOOGLE_CLIENT_SECRET
      ? { socialProviders: { google: { clientId: cfg.GOOGLE_CLIENT_ID, clientSecret: cfg.GOOGLE_CLIENT_SECRET, prompt: "select_account" as const } } }
      : {}),
    plugins: [username()],
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    // Behind Cloudflare the real client address is cf-connecting-ip. Counters live in Postgres so they hold across isolates.
    advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"] }, useSecureCookies: cfg.NODE_ENV === "production" },
    rateLimit: {
      enabled: cfg.NODE_ENV !== "test", storage: "database", window: 60, max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-in/username": { window: 60, max: 5 },
        "/sign-up/email": { window: 3600, max: 10 },
        "/request-password-reset": { window: 3600, max: 5 },
        "/reset-password": { window: 3600, max: 10 },
        "/change-password": { window: 3600, max: 10 },
      },
    },
  });
}
export type Auth = ReturnType<typeof createAuth>;
