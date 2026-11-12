import type { Db } from "../../infrastructure/database/db.js";
import type { Logger } from "../../infrastructure/logger/logger.js";
import type { AccountService } from "../accounts/account.service.js";
import type { AnalyticsService } from "../analytics/analytics.service.js";
import type { BillingPayments } from "../billing/billing.payments.js";
import type { BillingService } from "../billing/billing.service.js";
import type { ContentService } from "../content/content.service.js";
import type { WorkspaceService } from "../workspaces/workspace.service.js";

/** The application services MCP delegates to. No business logic lives in the MCP layer: same services, same rules as REST. */
export interface McpDeps { db: Db; log: Logger; workspaces: WorkspaceService; accounts: AccountService; content: ContentService; analytics: AnalyticsService; billing: BillingService; billingPayments: BillingPayments }
