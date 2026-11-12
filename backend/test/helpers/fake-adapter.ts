import { NO_CAPABILITIES, type MetricsResult, type PublicPost, type PublicProfile, type Platform, type PublishInput, type PublishResult, type SocialAdapter } from "../../src/integrations/core/types.js";

type Step = (call: number, input: PublishInput) => PublishResult | Promise<PublishResult>;
/** Test double for a platform API. Scripted per call; records every call. Never used outside tests. */
export function createFakeAdapter(platform: Platform, script: Step, o: { audience?: () => import("../../src/integrations/core/types.js").AudienceResult; reconcile?: SocialAdapter["reconcile"]; postMetrics?: (call: number, externalPostId: string) => MetricsResult | Promise<MetricsResult>; accountMetrics?: (call: number) => MetricsResult | Promise<MetricsResult>; competitor?: { profile: (handle: string) => PublicProfile | Promise<PublicProfile>; posts: (profile: { externalId: string }) => PublicPost[] | Promise<PublicPost[]> } } = {}) {
  const calls: PublishInput[] = [];
  const metricCalls = { post: 0, account: 0 };
  const adapter: SocialAdapter = {
    platform,
    capabilities: { ...NO_CAPABILITIES, textPost: true, imagePost: true, videoPost: true, lookupRecentPosts: !!o.reconcile, postAnalytics: !!o.postMetrics, accountAnalytics: !!o.accountMetrics, competitorLookup: !!o.competitor },
    oauth: { usesPkce: false, authorizationUrl: () => "https://fake/auth", exchangeCode: async () => { throw new Error("not used"); } },
    fetchAccount: async () => { throw new Error("not used"); },
    publish: async (i) => { calls.push(i); return script(calls.length, i); },
    ...(o.reconcile ? { reconcile: o.reconcile } : {}),
    ...(o.competitor ? { lookupPublicProfile: async (i: { handle: string }) => o.competitor!.profile(i.handle), fetchPublicPosts: async (i: { profile: { externalId: string } }) => o.competitor!.posts(i.profile) } : {}),
    ...(o.postMetrics ? { fetchPostMetrics: async (i: { externalPostId: string }) => o.postMetrics!(++metricCalls.post, i.externalPostId) } : {}),
    ...(o.audience ? { fetchAudience: async () => o.audience!() } : {}),
    ...(o.accountMetrics ? { fetchAccountMetrics: async () => o.accountMetrics!(++metricCalls.account) } : {}),
  };
  return { adapter, calls, metricCalls };
}
export const ok = (id = "ext-1"): PublishResult => ({ externalId: id, url: `https://fake/${id}`, raw: { id } });

export const metricsOf = (raw: Record<string, number | null>, source = "fake://metrics"): MetricsResult => ({
  metrics: Object.entries(raw).map(([originalName, value]) => (value === null ? { originalName, value: null, availability: "unavailable" as const } : { originalName, value, availability: "available" as const })),
  raw, source,
});
