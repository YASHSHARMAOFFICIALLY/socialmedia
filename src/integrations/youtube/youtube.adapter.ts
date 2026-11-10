import { NO_CAPABILITIES, type SocialAdapter } from "../core/types.js";
import { createYouTubeAnalytics } from "./youtube.analytics.js";
import { createYouTubeCompetitors } from "./youtube.competitors.js";
import { createYouTubeAuth } from "./youtube.auth.js";
import { createYouTubePublisher, createYouTubeReconciler } from "./youtube.publisher.js";

export function createYouTubeAdapter(cfg: { clientId: string; clientSecret: string }, f: typeof fetch = fetch): SocialAdapter {
  return {
    platform: "youtube",
    // videoPost only: YouTube needs a video. Shorts/thumbnails/scheduling/analytics are not implemented, so not claimed.
    capabilities: { ...NO_CAPABILITIES, videoPost: true, tokenRefresh: true, lookupRecentPosts: true, postAnalytics: true, accountAnalytics: true, engagementMetrics: true, competitorLookup: true },
    ...createYouTubeAuth(cfg, f),
    publish: createYouTubePublisher(f),
    reconcile: createYouTubeReconciler(f),
    ...createYouTubeAnalytics(f),
    ...createYouTubeCompetitors(f),
  };
}
