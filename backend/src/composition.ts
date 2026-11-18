import type { Deps } from "./app.js";
import type { Config } from "./config/env.js";
import type { Db } from "./infrastructure/database/db.js";
import type { Logger } from "./infrastructure/logger/logger.js";
import { createMailer, type Mailer } from "./infrastructure/email/resend.js";
import { createCipher } from "./infrastructure/encryption/cipher.js";
import { createRegistry } from "./integrations/core/registry.js";
import { createXAdapter } from "./integrations/x/x.adapter.js";
import { createYouTubeAdapter } from "./integrations/youtube/youtube.adapter.js";
import { createInstagramAdapter } from "./integrations/instagram/instagram.adapter.js";
import { createLinkedInAdapter } from "./integrations/linkedin/linkedin.adapter.js";
import { createThreadsAdapter } from "./integrations/threads/threads.adapter.js";
import { createFacebookAdapter } from "./integrations/facebook/facebook.adapter.js";
import { createPinterestAdapter } from "./integrations/pinterest/pinterest.adapter.js";
import { createTikTokAdapter } from "./integrations/tiktok/tiktok.adapter.js";
import { createBlueskyAdapter } from "./integrations/bluesky/bluesky.adapter.js";
import { createMastodonAdapter } from "./integrations/mastodon/mastodon.adapter.js";
import { createTelegramAdapter } from "./integrations/telegram/telegram.adapter.js";
import type { SocialAdapter } from "./integrations/core/types.js";
import { createAuth } from "./modules/auth/auth.js";
import { createWorkspaceService } from "./modules/workspaces/workspace.service.js";
import { contentRules } from "./integrations/rules.js";
import { createR2Storage, type ObjectStorage } from "./infrastructure/storage/storage.js";
import { cloudflareImageTransformer, type ImageTransformer } from "./infrastructure/storage/image-transform.js";
import { createMediaService } from "./modules/media/media.service.js";
import { createSchedulingService } from "./modules/scheduling/scheduling.service.js";
import { createCampaignService } from "./modules/campaigns/campaign.service.js";
import { createApprovalService } from "./modules/approvals/approval.service.js";
import { createNotificationService } from "./modules/notifications/notification.service.js";
import { createInsightsService } from "./modules/insights/insights.service.js";
import { createReportService } from "./modules/reports/report.service.js";
import { createRecurringService } from "./modules/recurring/recurring.service.js";
import { createWebhookService } from "./modules/webhooks/webhook.service.js";
import { createCompetitorService } from "./modules/competitors/competitor.service.js";
import { createAiService } from "./modules/ai/ai.service.js";
import { createAnthropicProvider } from "./infrastructure/ai/anthropic.js";
import type { AiProvider } from "./infrastructure/ai/provider.js";
import { createContentService } from "./modules/content/content.service.js";
import { createPublishingService } from "./modules/publishing/publishing.service.js";
import { createAnalyticsService } from "./modules/analytics/analytics.service.js";
import { createMemoryCache, type CacheStore } from "./infrastructure/cache/cache.js";
import { collectTarget, runAnalyticsSweep } from "./workers/analytics/collect.js";
import { handleAnalyticsBatch } from "./workers/analytics/consumer.js";
import type { AnalyticsMessage, JobQueue } from "./infrastructure/queues/queue.js";
import { handlePublishBatch } from "./workers/publishing/consumer.js";
import { processPublishJob, type EngineDeps } from "./workers/publishing/process-job.js";
import { dispatchOutbox, runPublishingSweep } from "./workers/publishing/sweeper.js";
import { type Gate } from "./modules/billing/gate.js";
import { createDodoProvider } from "./integrations/payments/dodo.adapter.js";
import type { PaymentProvider } from "./integrations/payments/types.js";
import { cloudflareVideoTransformer, type VideoTransformer } from "./infrastructure/storage/video-transform.js";
import { createBillingPayments } from "./modules/billing/billing.payments.js";
import { createMcpAuth } from "./modules/mcp/mcp.auth.js";
import { createBillingService } from "./modules/billing/billing.service.js";
import { createAccountService } from "./modules/accounts/account.service.js";
import { createMetrics } from "./modules/ops/metrics.js";

/** Composition root: the only place concrete implementations are wired together. */
export async function buildDeps(cfg: Config, log: Logger, db: Db, o: { mailer?: Mailer; adapters?: SocialAdapter[]; queue: JobQueue; analyticsQueue: JobQueue<AnalyticsMessage>; cache?: CacheStore; engine?: Partial<EngineDeps>; storage?: ObjectStorage | null; webhookFetch?: typeof fetch; aiProvider?: AiProvider | null; images?: ImageTransformer | null; videos?: VideoTransformer | null; payments?: PaymentProvider | null; defer?: (p: Promise<unknown>) => void }): Promise<Deps> {
  const mailer = o.mailer ?? createMailer({ apiKey: cfg.RESEND_API_KEY, from: cfg.EMAIL_FROM }, log);
  const adapters = o.adapters ?? [
    ...(cfg.LINKEDIN_CLIENT_ID && cfg.LINKEDIN_CLIENT_SECRET ? [createLinkedInAdapter({ clientId: cfg.LINKEDIN_CLIENT_ID, clientSecret: cfg.LINKEDIN_CLIENT_SECRET })] : []),
    ...(cfg.X_CLIENT_ID && cfg.X_CLIENT_SECRET ? [createXAdapter({ clientId: cfg.X_CLIENT_ID, clientSecret: cfg.X_CLIENT_SECRET })] : []),
    ...(cfg.GOOGLE_CLIENT_ID && cfg.GOOGLE_CLIENT_SECRET ? [createYouTubeAdapter({ clientId: cfg.GOOGLE_CLIENT_ID, clientSecret: cfg.GOOGLE_CLIENT_SECRET })] : []),
    ...(cfg.FACEBOOK_APP_ID && cfg.FACEBOOK_APP_SECRET ? [createInstagramAdapter({ clientId: cfg.FACEBOOK_APP_ID, clientSecret: cfg.FACEBOOK_APP_SECRET, configId: cfg.INSTAGRAM_FB_CONFIG_ID })] : []),   // Instagram API with Facebook Login: same Meta app
    ...(cfg.THREADS_APP_ID && cfg.THREADS_APP_SECRET ? [createThreadsAdapter({ clientId: cfg.THREADS_APP_ID, clientSecret: cfg.THREADS_APP_SECRET })] : []),
    ...(cfg.FACEBOOK_APP_ID && cfg.FACEBOOK_APP_SECRET ? [createFacebookAdapter({ clientId: cfg.FACEBOOK_APP_ID, clientSecret: cfg.FACEBOOK_APP_SECRET })] : []),
    ...(cfg.PINTEREST_APP_ID && cfg.PINTEREST_APP_SECRET ? [createPinterestAdapter({ clientId: cfg.PINTEREST_APP_ID, clientSecret: cfg.PINTEREST_APP_SECRET })] : []),
    ...(cfg.TIKTOK_CLIENT_KEY && cfg.TIKTOK_CLIENT_SECRET ? [createTikTokAdapter({ clientKey: cfg.TIKTOK_CLIENT_KEY, clientSecret: cfg.TIKTOK_CLIENT_SECRET })] : []),
    // Credentials-mode platforms need no app registration of ours: users bring their own app password / token.
    createBlueskyAdapter(cfg.BLUESKY_SERVICE ? { service: cfg.BLUESKY_SERVICE } : {}),
    createMastodonAdapter(),
    createTelegramAdapter(),
  ];
  // Late-bound: billing is built after the services it gates (it needs `workspaces`).
  const gate: Gate = (ws, feature, qty, q, at) => (cfg.BILLING_ENFORCE ? billing.enforce(ws, feature, qty, q, at) : Promise.resolve());
  const workspaces = createWorkspaceService(db, mailer, cfg.APP_URL ?? cfg.BETTER_AUTH_URL ?? "", gate);
  const registry = createRegistry(adapters);
  const cipher = cfg.TOKEN_ENC_KEYS ? await createCipher(cfg.TOKEN_ENC_KEYS) : null;
  const accounts = createAccountService({ db, cfg, workspaces, registry, cipher, log, gate });
  const webhooks = createWebhookService({ db, workspaces, cipher, log, allowInsecure: cfg.NODE_ENV === "development", ...(o.webhookFetch ? { fetch: o.webhookFetch } : {}) });
  const content = createContentService({ db, workspaces, registry, rules: contentRules });
  const storage = o.storage !== undefined ? o.storage
    : cfg.R2_ACCOUNT_ID && cfg.R2_ACCESS_KEY_ID && cfg.R2_SECRET_ACCESS_KEY && cfg.R2_BUCKET
      ? createR2Storage({ accountId: cfg.R2_ACCOUNT_ID, accessKeyId: cfg.R2_ACCESS_KEY_ID, secretAccessKey: cfg.R2_SECRET_ACCESS_KEY, bucket: cfg.R2_BUCKET }) : null;
  const media = createMediaService({ db, workspaces, storage, rules: contentRules, videos: o.videos !== undefined ? o.videos : cfg.MEDIA_TRANSFORM_ORIGIN ? cloudflareVideoTransformer(cfg.MEDIA_TRANSFORM_ORIGIN) : null, images: o.images !== undefined ? o.images : typeof (globalThis as { WebSocketPair?: unknown }).WebSocketPair !== "undefined" ? cloudflareImageTransformer() : null });
  // Platforms (Instagram in particular) download media from a URL: hand them a time-limited signed GET URL.
  const engineDeps: EngineDeps = { db, log, registry, accounts, content, ...(storage ? { mediaUrl: (key: string) => storage.presignGet(key, 3600) } : {}), ...o.engine };
  const notifications = createNotificationService({ db, workspaces, mailer, log, appUrl: cfg.APP_URL, webhooks: webhooks.emitter, producerLagS: cfg.NOTIFY_PRODUCER_LAG_S });
  const approvals = createApprovalService({ db, workspaces, content, notifications });
  const publishing = createPublishingService({ db, workspaces, content, log, gate, kick: () => dispatchOutbox(engineDeps, o.queue), approvalGate: approvals });
  const engine = {
    handleBatch: (m: Parameters<typeof handlePublishBatch>[1]) => handlePublishBatch(engineDeps, m),
    sweep: () => runPublishingSweep(engineDeps, o.queue),
    process: (jobId: string) => processPublishJob(engineDeps, jobId),
    analytics: {
      handleBatch: (m: Parameters<typeof handleAnalyticsBatch>[1]) => handleAnalyticsBatch(engineDeps, m),
      sweep: () => runAnalyticsSweep(engineDeps, o.analyticsQueue),
      collect: (id: string) => collectTarget(engineDeps, id),
    },
    notifications: { sweep: () => notifications.sweep() },
    reports: { sweep: () => reports.sweep(), purgeExpired: () => reports.purgeExpired() },
    recurring: { sweep: () => recurring.sweep() },
    webhooks: { sweep: () => webhooks.sweep(), purge: () => webhooks.purge() },
    competitors: { sweep: () => competitors.sweep() },
    mcp: { purge: () => mcpAuth.purge() },
    billing: { sweep: () => billingPayments.sweep(), purge: () => billingPayments.purge() },
    tokens: { keepAlive: () => accounts.keepAlive(), reencryptStale: () => accounts.reencryptStale() },
  };
  const analytics = createAnalyticsService({ db, workspaces, registry, cache: o.cache ?? createMemoryCache(), ...(cfg.BILLING_ENFORCE ? { historyDays: async (ws: string) => (await billing.check(ws, "analytics_history_days")).limit } : {}) });
  const reports = createReportService({ db, workspaces, analytics, log });
  const scheduling = createSchedulingService({ db, workspaces, publishing, content, gate });
  const competitors = createCompetitorService({ db, workspaces, registry, accounts, log });
  const aiProvider = o.aiProvider !== undefined ? o.aiProvider : cfg.ANTHROPIC_API_KEY ? createAnthropicProvider({ apiKey: cfg.ANTHROPIC_API_KEY, model: cfg.AI_MODEL }) : null;
  const ai = createAiService({ db, workspaces, content, rules: contentRules, provider: aiProvider, dailyLimit: cfg.AI_DAILY_LIMIT });
  const recurring = createRecurringService({ db, workspaces, content, scheduling, notifications, log });
  const billing = createBillingService({ db, workspaces });
  const mcpAuth = createMcpAuth({ db, workspaces });
  const provider = o.payments !== undefined ? o.payments : cfg.DODO_API_KEY && cfg.DODO_WEBHOOK_KEY ? createDodoProvider({ apiKey: cfg.DODO_API_KEY, webhookKey: cfg.DODO_WEBHOOK_KEY, mode: cfg.DODO_MODE }) : null;
  const billingPayments = createBillingPayments({ db, workspaces, provider, log, returnUrl: cfg.APP_URL ?? cfg.BETTER_AUTH_URL ?? "", notify: async (q, ws, type, title, body, ref) => notifications.notify(q, { workspaceId: ws, userIds: await notifications.holders(q, ws, "billing:manage"), type, title, body, ref }) });
  return { cfg, log, db, auth: createAuth(db, cfg, mailer), workspaces, accounts, content, publishing, media, scheduling, analytics, campaigns: createCampaignService({ db, workspaces, analytics }), approvals, notifications, reports, recurring, webhooks, competitors, ai, billing, billingPayments, mcpAuth, metrics: createMetrics({ db, log, defer: o.defer }), insights: createInsightsService({ db, workspaces, analytics }), storage, engine };
}
