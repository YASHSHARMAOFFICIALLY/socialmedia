import { NO_CAPABILITIES, type SocialAdapter } from "../core/types.js";
import { createXAnalytics } from "./x.analytics.js";
import { createXCompetitors } from "./x.competitors.js";
import { createXAuth } from "./x.auth.js";
import { createXPublisher, createXReconciler } from "./x.publisher.js";

export function createXAdapter(cfg: { clientId: string; clientSecret: string; pollMs?: number }, f: typeof fetch = fetch): SocialAdapter {
  return {
    platform: "x",
    // Access to these endpoints depends on the app's X API tier (paid); see docs/integrations.md.
    capabilities: { ...NO_CAPABILITIES, textPost: true, imagePost: true, videoPost: true, tokenRefresh: true, lookupRecentPosts: true, postAnalytics: true, accountAnalytics: true, engagementMetrics: true, competitorLookup: true },
    ...createXAuth(cfg, f),
    publish: createXPublisher(f, cfg.pollMs ? { pollMs: cfg.pollMs } : {}),
    reconcile: createXReconciler(f),
    ...createXAnalytics(f),
    ...createXCompetitors(f),
  };
}
