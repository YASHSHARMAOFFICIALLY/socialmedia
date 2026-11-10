import { describe, it, expect } from "vitest";
import { createInstagramAdapter } from "../../src/integrations/instagram/instagram.adapter.js";
import { createLinkedInAdapter } from "../../src/integrations/linkedin/linkedin.adapter.js";
import { createXAdapter } from "../../src/integrations/x/x.adapter.js";
import { createYouTubeAdapter } from "../../src/integrations/youtube/youtube.adapter.js";
import type { SocialAdapter } from "../../src/integrations/core/types.js";

const dummy = { clientId: "unused-for-api-calls", clientSecret: "unused-for-api-calls" };
const publishAllowed = process.env.LIVE_ALLOW_PUBLISH === "true";
const stamp = `[automated test] ${new Date().toISOString()}`;

function suite(name: string, token: string | undefined, adapter: SocialAdapter, o: { account?: boolean; accountMetrics?: boolean; publish?: boolean } = {}) {
  describe.skipIf(!token)(`${name} (live)`, () => {
    let profile: Awaited<ReturnType<SocialAdapter["fetchAccount"]>>;
    it("fetchAccount returns a stable id, a name and an account type", async () => {
      profile = await adapter.fetchAccount(token!);
      expect(profile.externalId).toBeTruthy();
      expect(profile.displayName).toBeTruthy();
      expect(["personal", "organization", "business", "channel"]).toContain(profile.accountType);
    });
    it.skipIf(!o.accountMetrics)("fetchAccountMetrics reports followers as a number or UNAVAILABLE (never invented)", async () => {
      const r = await adapter.fetchAccountMetrics!({ accessToken: token!, account: { externalId: profile.externalId, metadata: profile.metadata ?? {} } });
      expect(r.metrics.length).toBeGreaterThan(0);
      for (const m of r.metrics) expect(m.availability === "available" ? typeof m.value === "number" : m.value === null).toBe(true);
    });
    it.skipIf(!o.publish || !publishAllowed)("publishes a text post and returns an id + URL (REAL POST)", async () => {
      const r = await adapter.publish!({
        accessToken: token!, account: { externalId: profile.externalId, metadata: profile.metadata ?? {} }, media: [], idempotencyKey: `live:${stamp}`, signal: new AbortController().signal,
        content: { text: stamp, title: null, description: null, hashtags: [], media: [], metadata: {} },
      });
      expect(r.externalId).toBeTruthy();
      console.log(`${name}: published ${r.url ?? r.externalId} (delete it manually)`);
    });
  });
}

suite("LinkedIn", process.env.LIVE_LINKEDIN_TOKEN, createLinkedInAdapter(dummy), { publish: true });
suite("X", process.env.LIVE_X_TOKEN, createXAdapter(dummy), { accountMetrics: true, publish: true });
suite("YouTube", process.env.LIVE_YOUTUBE_TOKEN, createYouTubeAdapter(dummy), { accountMetrics: true });
suite("Instagram", process.env.LIVE_INSTAGRAM_TOKEN, createInstagramAdapter(dummy), { accountMetrics: true });
