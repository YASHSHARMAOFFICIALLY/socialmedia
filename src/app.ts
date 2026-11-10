import express from "express";
import helmet from "helmet";
import cors from "cors";
import { docsPage } from "./shared/swagger.js";
import type { Db } from "./infrastructure/database/db.js";
import type { Config } from "./config/env.js";
import type { Logger } from "./infrastructure/logger/logger.js";
import { buildSpec, registry } from "./shared/openapi.js";
import { toNodeHandler } from "better-auth/node";
import type { Auth } from "./modules/auth/auth.js";
import type { WorkspaceService } from "./modules/workspaces/workspace.service.js";
import type { AccountService } from "./modules/accounts/account.service.js";
import { accountRoutes } from "./modules/accounts/account.routes.js";
import { registerAccountDocs } from "./modules/accounts/account.openapi.js";
import type { ContentService } from "./modules/content/content.service.js";
import { contentRoutes } from "./modules/content/content.routes.js";
import { registerContentDocs } from "./modules/content/content.openapi.js";
import type { PublishingService } from "./modules/publishing/publishing.service.js";
import { publishingRoutes } from "./modules/publishing/publishing.routes.js";
import { registerPublishingDocs } from "./modules/publishing/publishing.openapi.js";
import type { MediaService } from "./modules/media/media.service.js";
import { mediaRoutes } from "./modules/media/media.routes.js";
import { registerMediaDocs } from "./modules/media/media.openapi.js";
import type { SchedulingService } from "./modules/scheduling/scheduling.service.js";
import { schedulingRoutes } from "./modules/scheduling/scheduling.routes.js";
import { registerSchedulingDocs } from "./modules/scheduling/scheduling.openapi.js";
import type { AnalyticsService } from "./modules/analytics/analytics.service.js";
import { analyticsRoutes } from "./modules/analytics/analytics.routes.js";
import { registerAnalyticsDocs } from "./modules/analytics/analytics.openapi.js";
import type { CampaignService } from "./modules/campaigns/campaign.service.js";
import { campaignRoutes } from "./modules/campaigns/campaign.routes.js";
import { registerCampaignDocs } from "./modules/campaigns/campaign.openapi.js";
import type { ApprovalService } from "./modules/approvals/approval.service.js";
import { approvalRoutes } from "./modules/approvals/approval.routes.js";
import { registerApprovalDocs } from "./modules/approvals/approval.openapi.js";
import type { NotificationService } from "./modules/notifications/notification.service.js";
import { notificationRoutes } from "./modules/notifications/notification.routes.js";
import { registerNotificationDocs } from "./modules/notifications/notification.openapi.js";
import type { InsightsService } from "./modules/insights/insights.service.js";
import { insightsRoutes } from "./modules/insights/insights.routes.js";
import { registerInsightDocs } from "./modules/insights/insights.openapi.js";
import type { ReportService } from "./modules/reports/report.service.js";
import { reportRoutes } from "./modules/reports/report.routes.js";
import { registerReportDocs } from "./modules/reports/report.openapi.js";
import { createRateLimiter } from "./shared/middleware/rate-limit.js";
import { noStore, originGuard } from "./shared/middleware/security.js";
import type { RecurringService } from "./modules/recurring/recurring.service.js";
import { recurringRoutes } from "./modules/recurring/recurring.routes.js";
import { registerRecurringDocs } from "./modules/recurring/recurring.openapi.js";
import type { WebhookService } from "./modules/webhooks/webhook.service.js";
import { webhookRoutes } from "./modules/webhooks/webhook.routes.js";
import { registerWebhookDocs } from "./modules/webhooks/webhook.openapi.js";
import { inboundWebhookRoutes } from "./modules/webhooks/inbound.js";
import type { CompetitorService } from "./modules/competitors/competitor.service.js";
import { competitorRoutes } from "./modules/competitors/competitor.routes.js";
import { registerCompetitorDocs } from "./modules/competitors/competitor.openapi.js";
import type { AiService } from "./modules/ai/ai.service.js";
import { aiRoutes } from "./modules/ai/ai.routes.js";
import { registerAiDocs } from "./modules/ai/ai.openapi.js";
import type { BillingService } from "./modules/billing/billing.service.js";
import type { BillingPayments } from "./modules/billing/billing.payments.js";
import { billingRoutes, billingWebhookRoutes } from "./modules/billing/billing.routes.js";
import { registerBillingDocs } from "./modules/billing/billing.openapi.js";
import { createMcpAuth, type McpAuth } from "./modules/mcp/mcp.auth.js";
import { mcpRoutes } from "./modules/mcp/mcp.routes.js";
import { registerMcpDocs } from "./modules/mcp/mcp.openapi.js";
import { requireAuth } from "./shared/middleware/auth.js";
import { workspaceRoutes } from "./modules/workspaces/workspace.routes.js";
import { registerAuthDocs, registerWorkspaceDocs } from "./modules/workspaces/workspace.openapi.js";
import { errorHandler, notFoundHandler, requestId } from "./shared/middleware/http.js";
import { healthRoutes } from "./modules/health/health.routes.js";
import { registerHealthDocs } from "./modules/health/health.openapi.js";

/** Background-side handles (queue consumer + cron) built by the composition root; the HTTP app does not call them directly. */
export interface Engine {
  handleBatch(messages: readonly import("./workers/publishing/consumer.js").QueueMessageLike[]): Promise<void>;
  sweep(): Promise<import("./workers/publishing/sweeper.js").SweepReport>;
  process(jobId: string): Promise<import("./workers/publishing/process-job.js").ProcessResult>;
  /** Analytics runs on its own queue and code path: nothing in it can block or fail publishing. */
  analytics: {
    handleBatch(messages: readonly import("./workers/analytics/consumer.js").AnalyticsMessageLike[]): Promise<void>;
    sweep(): Promise<import("./workers/analytics/collect.js").AnalyticsSweepReport>;
    collect(targetId: string): Promise<"collected" | "skipped" | "failed">;
  };
  /** Notification producers + email delivery: isolated from publishing (reads events with a cursor). */
  notifications: { sweep(): Promise<{ published: number; accounts: number; emails: number; errors: string[] }> };
  reports: { sweep(): Promise<{ claimed: number; done: number }>; purgeExpired(): Promise<number> };
  competitors: { sweep(): Promise<{ due: number; collected: number; failed: number }> };
  webhooks: { sweep(): Promise<{ due: number; delivered: number; failed: number }>; purge(): Promise<number> };
  billing: { sweep(): Promise<{ due: number; processed: number }>; purge(): Promise<number> };
  mcp: { purge(): Promise<void> };
  recurring: { sweep(): Promise<{ materialized: number; scheduled: number; failed: number; skipped: number }> };
  tokens: { keepAlive(): Promise<{ due: number; refreshed: number; failed: number }>; reencryptStale(): Promise<{ rewritten: number; remaining: number | string }> };
}
export interface Deps { cfg: Config; log: Logger; db: Db; auth: Auth; workspaces: WorkspaceService; accounts: AccountService; content: ContentService; publishing: PublishingService; media: MediaService; scheduling: SchedulingService; analytics: AnalyticsService; campaigns: CampaignService; approvals: ApprovalService; notifications: NotificationService; insights: InsightsService; reports: ReportService; recurring: RecurringService; webhooks: WebhookService; competitors: CompetitorService; ai: AiService; billing: BillingService; billingPayments: BillingPayments; mcpAuth: McpAuth; storage?: import("./infrastructure/storage/storage.js").ObjectStorage | null; engine: Engine }

let docsRegistered = false;

export function createApp({ cfg, log, db, auth, workspaces, accounts, content, publishing, media, scheduling, analytics, campaigns, approvals, notifications, insights, reports, recurring, webhooks, competitors, ai, billing, billingPayments, mcpAuth }: Deps) {
  if (!docsRegistered) {   // the registry is process-wide: register each module's paths exactly once
    docsRegistered = true;
    registerHealthDocs(registry);
    registerAuthDocs(registry);
    registerWorkspaceDocs(registry);
    registerAccountDocs(registry);
    registerContentDocs(registry);
    registerPublishingDocs(registry);
    registerMediaDocs(registry);
    registerSchedulingDocs(registry);
    registerAnalyticsDocs(registry);
    registerCampaignDocs(registry);
    registerApprovalDocs(registry);
    registerNotificationDocs(registry);
    registerInsightDocs(registry);
    registerReportDocs(registry);
    registerRecurringDocs(registry);
    registerWebhookDocs(registry);
    registerCompetitorDocs(registry);
    registerAiDocs(registry);
    registerBillingDocs(registry);
    registerMcpDocs(registry);
  }
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // behind Cloudflare / one proxy hop
  app.use(requestId);
  // pino-http needs pino internals absent from pino's browser build (used on Workers), so log requests directly.
  app.use((req, res, next) => {
    const t = Date.now();
    res.on("finish", () => {
      if (req.url.startsWith("/health")) return;
      log.info({ requestId: req.id, method: req.method, url: req.originalUrl.split("?")[0], status: res.statusCode, ms: Date.now() - t }, "request");
    });
    next();
  });
  app.use(helmet());
  app.use(noStore);
  app.use(cors({ origin: cfg.CORS_ORIGINS, credentials: true }));
  app.use(originGuard(cfg.CORS_ORIGINS, cfg.BETTER_AUTH_URL ? new URL(cfg.BETTER_AUTH_URL).origin : undefined));
  // Better Auth parses its own body, so it must be mounted before express.json.
  app.all("/api/auth/*splat", toNodeHandler(auth));
  app.use(express.json({ limit: "1mb", verify: (req, _res, buf) => { (req as express.Request).rawBody = buf; } }));

  app.use(healthRoutes({ db, opsToken: cfg.OPS_TOKEN }));

  // Second line of defence behind Cloudflare edge rate limiting: per-user limits on the expensive or abuse-prone endpoints.
  const limit = createRateLimiter(db, log);
  const authed = requireAuth(auth);
  app.post("/workspaces/:workspaceId/accounts/connect", authed, limit({ name: "oauth-connect", limit: 10, windowS: 60 }));
  app.post("/workspaces/:workspaceId/posts/:postId/publish", authed, limit({ name: "publish", limit: 30, windowS: 60 }));
  app.post("/workspaces/:workspaceId/posts/:postId/schedule", authed, limit({ name: "schedule", limit: 60, windowS: 60 }));
  app.post("/workspaces/:workspaceId/media/uploads", authed, limit({ name: "media-upload", limit: 60, windowS: 60 }));
  app.post("/workspaces/:workspaceId/reports", authed, limit({ name: "report", limit: 10, windowS: 3600 }));
  app.post("/workspaces/:workspaceId/bulk/*splat", authed, limit({ name: "bulk", limit: 20, windowS: 60 }));
  app.post("/workspaces/:workspaceId/invitations", authed, limit({ name: "invite", limit: 20, windowS: 3600 }));
  app.post("/invitations/accept", authed, limit({ name: "invite-accept", limit: 20, windowS: 3600 }));
  app.get("/oauth/:platform/callback", limit({ name: "oauth-callback", limit: 30, windowS: 60 }));
  app.use(workspaceRoutes(workspaces, authed));
  app.use(accountRoutes(accounts, authed, { appUrl: cfg.APP_URL }));
  app.use(contentRoutes(content, authed));
  app.use(publishingRoutes(publishing, authed));
  app.use(mediaRoutes(media, authed));
  app.use(schedulingRoutes(scheduling, authed));
  app.use(analyticsRoutes(analytics, authed));
  app.use(campaignRoutes(campaigns, authed));
  app.use(approvalRoutes(approvals, authed));
  app.use(notificationRoutes(notifications, authed));
  app.use(insightsRoutes(insights, authed));
  app.use(reportRoutes(reports, authed));
  app.use(recurringRoutes(recurring, authed));
  app.use(webhookRoutes(webhooks, authed));
  app.use(competitorRoutes(competitors, authed));
  app.post("/workspaces/:workspaceId/posts/:postId/adapt", authed, limit({ name: "ai", limit: 20, windowS: 60 }));
  app.post("/workspaces/:workspaceId/ai/suggestions", authed, limit({ name: "ai", limit: 20, windowS: 60 }));
  app.use(aiRoutes(ai, authed));
  app.use(billingRoutes(billing, billingPayments, authed));
  // Platform -> us. Public by necessity; trust comes only from the platform's cryptographic signature (verified before anything is stored).
  const hookLimit = createRateLimiter(db, log);
  app.use("/webhooks", hookLimit({ name: "platform-webhooks", limit: 600, windowS: 60, key: (req) => req.header("cf-connecting-ip") ?? req.ip ?? "unknown" }));
  app.use(billingWebhookRoutes(billingPayments));
  app.use(mcpRoutes({ auth: mcpAuth, deps: { db, log, workspaces, accounts, content, analytics, billing, billingPayments }, log, publicUrl: cfg.BETTER_AUTH_URL, allowedOrigins: cfg.CORS_ORIGINS, authed, limit }));
  app.use(inboundWebhookRoutes({ db, log, instagramAppSecret: cfg.INSTAGRAM_APP_SECRET, instagramVerifyToken: cfg.INSTAGRAM_WEBHOOK_VERIFY_TOKEN, publicUrl: cfg.BETTER_AUTH_URL ?? "", disconnect: accounts.disconnectByExternalId }));
  app.get("/openapi.json", (_req, res) => res.json(buildSpec()));
  app.get("/docs", docsPage);

  app.use(notFoundHandler);
  app.use(errorHandler(log));
  return app;
}
