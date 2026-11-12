import { describe, it, expect } from "vitest";
import { JOB_STATUSES, backoffSeconds, canTransition, decideFailure, isCancellable } from "../src/modules/publishing/publishing.state-machine.js";
import { PlatformError } from "../src/integrations/core/errors.js";

describe("publishing state machine", () => {
  it("allows only the documented transitions", () => {
    const allowed = new Set(["scheduled>pending", "scheduled>processing", "scheduled>cancelled", "pending>processing", "pending>cancelled", "processing>published", "processing>failed", "processing>pending", "failed>pending"]);
    for (const a of JOB_STATUSES) for (const b of JOB_STATUSES) expect(canTransition(a, b), `${a}>${b}`).toBe(allowed.has(`${a}>${b}`));
  });
  it("published and cancelled are terminal; only pending/scheduled can be cancelled", () => {
    expect(JOB_STATUSES.filter(isCancellable)).toEqual(["pending", "scheduled"]);
    expect(JOB_STATUSES.filter((s) => canTransition(s, "pending")).sort()).toEqual(["failed", "processing", "scheduled"]);
  });
});

describe("retry policy", () => {
  const r0 = () => 1; // max jitter => full nominal delay
  it("backs off exponentially, capped at one hour, with jitter between 50% and 100%", () => {
    expect([1, 2, 3, 4].map((n) => backoffSeconds(n, r0))).toEqual([30, 60, 120, 240]);
    expect(backoffSeconds(20, r0)).toBe(3600);
    expect(backoffSeconds(3, () => 0)).toBe(60);
  });
  it("retries transient failures until max attempts, then gives up as 'exhausted'", () => {
    expect(decideFailure(new PlatformError("retryable", "503"), 1, 5, r0)).toMatchObject({ action: "retry", delayS: 30 });
    expect(decideFailure(new PlatformError("retryable", "503"), 5, 5, r0)).toMatchObject({ action: "fail", kind: "exhausted" });
  });
  it("honours Retry-After for rate limits when longer than the backoff", () => {
    expect(decideFailure(new PlatformError("rate_limited", "429", { retryAfterS: 900 }), 1, 5, r0)).toMatchObject({ action: "retry", delayS: 900, kind: "rate_limited" });
    expect(decideFailure(new PlatformError("rate_limited", "429", { retryAfterS: 1 }), 2, 5, r0)).toMatchObject({ delayS: 60 });
  });
  it("never retries permanent failures or revoked auth", () => {
    expect(decideFailure(new PlatformError("permanent", "bad media"), 1, 5)).toMatchObject({ action: "fail", kind: "permanent" });
    expect(decideFailure(new PlatformError("auth_expired", "revoked"), 1, 5)).toMatchObject({ action: "fail", kind: "auth_expired" });
    expect(decideFailure(new Error("boom"), 1, 5)).toMatchObject({ action: "fail", kind: "permanent" });
  });
  it("sends unknown outcomes to reconciliation, never to retry", () => {
    expect(decideFailure(new PlatformError("unknown", "timeout"), 1, 5)).toMatchObject({ action: "reconcile" });
  });
});
