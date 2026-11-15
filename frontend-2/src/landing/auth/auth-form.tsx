"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { apiUrl } from "@/lib/site";
import { LogoMark } from "../sections/site-header";

// Login and sign-up against the backend's Better Auth endpoints. The session is the httpOnly
// cookie Better Auth sets; this page never sees or stores a token.
//   login:  email or username + password  (POST /sign-in/email or /sign-in/username)
//   signup: username + email + password    (POST /sign-up/email, username plugin)
//   Google: POST /sign-in/social returns Google's consent URL, then the browser goes there.
type Mode = "login" | "signup";
const AFTER_AUTH = "/"; // ponytail: no signed-in app in this frontend yet; send people home

async function post(path: string, body: unknown) {
  const r = await fetch(`${apiUrl}/api/auth${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}

function message(status: number, mode: Mode, code?: string) {
  if (status === 401) return "That email or username and password don't match.";
  if (status === 403) return "Verify your email first. We sent you a link when you signed up.";
  if (status === 429) return "Too many tries. Wait a minute and try again.";
  if (mode === "signup" && /USERNAME/i.test(code ?? "")) return code === "USERNAME_IS_ALREADY_TAKEN" ? "That username is taken. Try another." : "Usernames are 3 to 30 letters, numbers, dots or underscores.";
  if (mode === "signup" && /EXISTS|ALREADY/i.test(code ?? "")) return "An account with that email already exists. Log in instead.";
  if (mode === "signup" && /PASSWORD/i.test(code ?? "")) return "Use at least 10 characters for your password.";
  return "Something went wrong. Try again.";
}

const field = "mt-2 block w-full rounded-xl border border-line bg-white px-3.5 py-3 text-base text-ink placeholder:text-muted/70 focus-visible:border-ink";
const label = "block text-sm font-medium text-ink";

export function AuthForm({ mode }: { mode: Mode }) {
  const [busy, setBusy] = useState<"form" | "google" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const signup = mode === "signup";
  const router = useRouter();

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const password = String(f.get("password"));
    setBusy("form");
    setError(null);
    try {
      let res;
      if (signup) {
        const username = String(f.get("username")).trim();
        res = await post("/sign-up/email", { name: username, username, email: String(f.get("email")).trim(), password });
      } else {
        const id = String(f.get("identifier")).trim();
        res = id.includes("@") ? await post("/sign-in/email", { email: id, password }) : await post("/sign-in/username", { username: id, password });
      }
      if (res.status >= 400) return setError(message(res.status, mode, res.data?.code));
      // Sign-up with required email verification returns no session: tell them to check the inbox.
      if (signup && !res.data?.token) return setNotice("Check your inbox and open the link we sent to finish signing up.");
      router.push(AFTER_AUTH);
    } catch {
      setError("Can't reach Distora right now. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function google() {
    setBusy("google");
    setError(null);
    try {
      const res = await post("/sign-in/social", { provider: "google", callbackURL: `${window.location.origin}${AFTER_AUTH}`, errorCallbackURL: window.location.href });
      if (res.status >= 400 || !res.data?.url) return setError("Google sign-in isn't available right now. Use your email or username instead.");
      window.location.assign(res.data.url);
    } catch {
      setError("Can't reach Distora right now. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  if (notice) {
    return (
      <div aria-live="polite">
        <h1 className="font-heading text-heading text-ink">Check your inbox</h1>
        <p className="mt-4 text-base text-muted">{notice}</p>
        <Link href="/login" className="mt-8 inline-flex min-h-11 items-center text-sm font-semibold text-ink underline underline-offset-4">
          Back to log in
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-heading text-heading text-ink">{signup ? "Create your account" : "Welcome back"}</h1>
      <p className="mt-3 text-base text-muted">{signup ? "Write once, post everywhere. It takes a minute." : "Log in to schedule, publish and check your posts."}</p>

      <button
        type="button"
        onClick={google}
        disabled={busy !== null}
        className="mt-8 inline-flex min-h-12 w-full items-center justify-center gap-3 rounded-xl border border-line bg-white text-sm font-semibold text-ink transition-colors hover:border-ink disabled:opacity-60"
      >
        <svg aria-hidden viewBox="0 0 24 24" className="size-5">
          <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.8Z" />
          <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.1-4 1.1-3.1 0-5.7-2.1-6.6-4.9h-4v3.1A12 12 0 0 0 12 24Z" />
          <path fill="#FBBC05" d="M5.4 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1Z" />
          <path fill="#EA4335" d="M12 4.8c1.7 0 3.3.6 4.5 1.8l3.4-3.4A11.9 11.9 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8Z" />
        </svg>
        {busy === "google" ? "Opening Google…" : "Continue with Google"}
      </button>

      <div className="my-7 flex items-center gap-4 text-xs text-muted">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>

      <form onSubmit={submit} className="space-y-5">
        {signup ? (
          <>
            <div>
              <label htmlFor="username" className={label}>
                Username
              </label>
              <input id="username" name="username" required minLength={3} maxLength={30} pattern="[A-Za-z0-9_.]{3,30}" autoComplete="username" className={field} />
              <p className="mt-1.5 text-xs text-muted">3 to 30 letters, numbers, dots or underscores.</p>
            </div>
            <div>
              <label htmlFor="email" className={label}>
                Email
              </label>
              <input id="email" name="email" type="email" required autoComplete="email" className={field} />
            </div>
          </>
        ) : (
          <div>
            <label htmlFor="identifier" className={label}>
              Email or username
            </label>
            <input id="identifier" name="identifier" required autoComplete="username" className={field} />
          </div>
        )}
        <div>
          <label htmlFor="password" className={label}>
            Password
          </label>
          <input id="password" name="password" type="password" required minLength={signup ? 10 : 1} maxLength={128} autoComplete={signup ? "new-password" : "current-password"} className={field} />
          {signup && <p className="mt-1.5 text-xs text-muted">At least 10 characters.</p>}
        </div>

        {error && (
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800">
            {error}
          </p>
        )}

        <button type="submit" disabled={busy !== null} className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-ink text-sm font-semibold text-white transition-colors hover:bg-ink/85 disabled:opacity-60">
          {busy === "form" ? (signup ? "Creating account…" : "Logging in…") : signup ? "Create account" : "Log in"}
        </button>
      </form>

      <p className="mt-8 text-sm text-muted">
        {signup ? "Already have an account? " : "New to Distora? "}
        <Link href={signup ? "/login" : "/signup"} className="inline-flex min-h-11 items-center font-semibold text-ink underline decoration-line underline-offset-4 hover:decoration-ink">
          {signup ? "Log in" : "Create an account"}
        </Link>
      </p>
    </div>
  );
}

// Page shell: form on the left, right side left blank (white) on purpose for now.
export function AuthPage({ mode }: { mode: Mode }) {
  return (
    <div className="grid min-h-dvh flex-1 bg-white font-sans text-ink lg:grid-cols-2">
      <main className="flex flex-col px-6 py-8 sm:px-12 lg:px-16">
        <Link href="/" className="inline-flex min-h-11 w-fit items-center gap-2.5 font-heading text-2xl text-ink">
          <LogoMark />
          Distora
        </Link>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          <AuthForm mode={mode} />
        </div>
      </main>
      <div aria-hidden className="hidden bg-white lg:block" />
    </div>
  );
}
