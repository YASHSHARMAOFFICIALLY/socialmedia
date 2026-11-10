import { PlatformError } from "../../integrations/core/errors.js";

export const JOB_STATUSES = ["pending", "scheduled", "processing", "published", "failed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/**
 * Allowed transitions. The SQL UPDATEs are additionally guarded by `WHERE status = ...` (and a lease fence), so even a racing
 * worker can't make an illegal move; this table is the single readable definition used by services and tests.
 */
const TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  scheduled: ["pending", "processing", "cancelled"],
  pending: ["processing", "cancelled"],
  processing: ["published", "failed", "pending"],   // pending = scheduled retry after a transient failure
  failed: ["pending"],                              // manual retry
  published: [],
  cancelled: [],
};
export const canTransition = (from: JobStatus, to: JobStatus) => TRANSITIONS[from].includes(to);
export const isTerminal = (s: JobStatus) => s === "published" || s === "cancelled";
export const isCancellable = (s: JobStatus) => canTransition(s, "cancelled");

export type FailureDecision =
  | { action: "retry"; delayS: number; kind: "retryable" | "rate_limited"; message: string }
  | { action: "fail"; kind: "permanent" | "auth_expired" | "exhausted"; message: string }
  | { action: "reconcile"; message: string };

const BASE_DELAY_S = 30, MAX_DELAY_S = 3600;
/** Exponential backoff with jitter in [50%,100%] of the nominal delay. */
export const backoffSeconds = (attemptNo: number, random = Math.random) => Math.round(Math.min(MAX_DELAY_S, BASE_DELAY_S * 2 ** (attemptNo - 1)) * (0.5 + random() * 0.5));

/** Pure retry policy: which failures retry, which are final, which need reconciliation instead of a retry. */
export function decideFailure(err: unknown, attemptNo: number, maxAttempts: number, random = Math.random): FailureDecision {
  const e = err instanceof PlatformError ? err : new PlatformError("permanent", err instanceof Error ? err.message : "Unexpected error");
  switch (e.kind) {
    case "retryable":
    case "rate_limited": {
      if (attemptNo >= maxAttempts) return { action: "fail", kind: "exhausted", message: `Gave up after ${attemptNo} attempts: ${e.message}` };
      const delayS = Math.max(backoffSeconds(attemptNo, random), e.kind === "rate_limited" ? (e.opts.retryAfterS ?? 0) : 0);
      return { action: "retry", delayS, kind: e.kind, message: e.message };
    }
    case "unknown": return { action: "reconcile", message: e.message };
    case "auth_expired": return { action: "fail", kind: "auth_expired", message: e.message };
    default: return { action: "fail", kind: "permanent", message: e.message };
  }
}
