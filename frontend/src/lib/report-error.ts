import Clarity from "@microsoft/clarity";

/** Logs a client crash and tags the Clarity session, so crashed visits can be filtered and replayed. */
export function reportError(error: unknown) {
  console.error(error);
  try {
    const digest = (error as { digest?: string } | null)?.digest;
    Clarity.setTag("error", digest ?? (error instanceof Error ? error.message.slice(0, 100) : "unknown"));
    Clarity.event("page_error");
    Clarity.upgrade("page_error"); // keep this session's recording even if sampling would drop it
  } catch {
    // Clarity blocked (ad blocker) or not started: the console line is all we get.
  }
}
