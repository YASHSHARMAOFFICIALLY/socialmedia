import { NO_CAPABILITIES, type SocialAdapter } from "../core/types.js";
import { createInstagramAnalytics } from "./instagram.analytics.js";
import { createInstagramAuth } from "./instagram.auth.js";
import { createInstagramPublisher, createInstagramReconciler } from "./instagram.publisher.js";

export function createInstagramAdapter(cfg: { clientId: string; clientSecret: string; pollMs?: number }, f: typeof fetch = fetch): SocialAdapter {
  return {
    platform: "instagram",
    // Requires Meta app review for the publish permission and a professional (Business/Creator) account; see docs/integrations.md.
    capabilities: { ...NO_CAPABILITIES, imagePost: true, videoPost: true, reel: true, carousel: true, tokenRefresh: true, lookupRecentPosts: true, postAnalytics: true, accountAnalytics: true, engagementMetrics: true },
    ...createInstagramAuth(cfg, f),
    publish: createInstagramPublisher(f, cfg.pollMs ? { pollMs: cfg.pollMs } : {}),
    reconcile: createInstagramReconciler(f),
    ...createInstagramAnalytics(f),
  };
}
