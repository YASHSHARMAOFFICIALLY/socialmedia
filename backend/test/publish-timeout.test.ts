import { describe, it, expect } from "vitest";
import { publishTimeoutMs } from "../src/workers/publishing/process-job.js";

const media = (kind: "image" | "video", mb: number) => ({ kind, sizeBytes: mb * 1024 * 1024 });

describe("publishTimeoutMs", () => {
  it("text posts keep the 120s base", () => {
    expect(publishTimeoutMs([])).toBe(120_000);
  });
  it("videos and large media get more time, capped below the queue consumer's wall limit", () => {
    expect(publishTimeoutMs([media("video", 100)])).toBeGreaterThan(240_000);
    expect(publishTimeoutMs([media("video", 5000)])).toBe(600_000);
  });
});
