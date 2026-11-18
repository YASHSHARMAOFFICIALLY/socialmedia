import { describe, it, expect } from "vitest";
import { matchRecentPost } from "../../src/integrations/core/reconcile.js";

const since = new Date("2026-11-19T10:00:00Z");
const later = "2026-11-19T10:00:05Z";

describe("matchRecentPost", () => {
  it("matches X text whose links and media were rewritten to t.co", () => {
    const items = [{ id: "1", text: "Read https://t.co/AbC &amp; share https://t.co/media9", at: later }];
    const hit = matchRecentPost(items, "Read https://example.com/post & share", since, []);
    expect(hit?.id).toBe("1");
  });

  it("ignores posts older than the current attempt (yesterday's identical recurring post)", () => {
    const items = [{ id: "old", text: "Daily tip", at: "2026-11-18T10:00:05Z" }];
    expect(matchRecentPost(items, "Daily tip", since, [])).toBeNull();
  });

  it("ignores posts without a timestamp", () => {
    expect(matchRecentPost([{ id: "1", text: "Daily tip" }], "Daily tip", since, [])).toBeNull();
  });

  it("skips external ids already recorded on other jobs and takes the next match", () => {
    const items = [
      { id: "taken", text: "Daily tip", at: later },
      { id: "mine", text: "Daily tip", at: later },
    ];
    expect(matchRecentPost(items, "Daily tip", since, ["taken"])?.id).toBe("mine");
  });

  it("does not match different text", () => {
    expect(matchRecentPost([{ id: "1", text: "Other", at: later }], "Daily tip", since, [])).toBeNull();
  });
});
