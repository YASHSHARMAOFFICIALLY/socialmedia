import type { Logger } from "../logger/logger.js";

export interface Mailer { send(m: { to: string; subject: string; html: string }): Promise<void> }

/** Resend over plain fetch (no SDK). Without an API key, emails are logged instead (dev/test). */
export function createMailer(opts: { apiKey?: string | undefined; from?: string | undefined }, log: Logger): Mailer {
  return {
    async send(m) {
      if (!opts.apiKey) {
        log.info({ to: m.to, subject: m.subject }, "email not sent (RESEND_API_KEY unset)");
        return;
      }
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: opts.from ?? "onboarding@resend.dev", to: m.to, subject: m.subject, html: m.html }),
      });
      if (!res.ok) throw new Error(`Resend responded ${res.status}`);
    },
  };
}
