import * as z from "zod/v4";
import { defineTool } from "./mcp.types.js";

const workspaceId = z.uuid().optional().describe("Workspace ID. Optional when you belong to exactly one workspace or your connection is bound to one.");
const NOTE = "Read-only. Upgrades, downgrades, cancellations, refunds and payment-method changes are never done through MCP: use create_billing_portal_session or the billing page.";

export const billingTools = [
  defineTool({
    name: "get_subscription", title: "Get subscription", scope: "billing:read", gated: false,
    description: `Subscription state of the workspace (status, interval, renewal date, whether it cancels at period end). status null/plan free means no paid subscription. ${NOTE}`,
    input: z.object({ workspaceId }),
    handler: async (c) => { const o = await c.deps.billing.overview(c.actor, c.workspaceId); return { plan: o.plan.key, subscription: o.subscription }; },
  }),
  defineTool({
    name: "get_current_plan", title: "Get current plan", scope: "billing:read", gated: false,
    description: `The workspace's current plan with its entitlement limits (null limit = unlimited). ${NOTE}`,
    input: z.object({ workspaceId }),
    handler: async (c) => { const o = await c.deps.billing.overview(c.actor, c.workspaceId); return { plan: o.plan, limits: Object.fromEntries(o.features.map((f) => [f.feature, { kind: f.kind, limit: f.limit }])) }; },
  }),
  defineTool({
    name: "get_usage_summary", title: "Get usage summary", scope: "billing:read", gated: false,
    description: `Current usage against plan limits (connected accounts, seats, posts this month). Usage period starts at usagePeriodStart (UTC calendar month). ${NOTE}`,
    input: z.object({ workspaceId }),
    handler: async (c) => { const o = await c.deps.billing.overview(c.actor, c.workspaceId); return { plan: o.plan.key, usagePeriodStart: o.usagePeriodStart, features: o.features.filter((f) => f.used !== null) }; },
  }),
  defineTool({
    name: "list_invoices", title: "List payments", scope: "billing:read", gated: false,
    description: `Payments recorded for the workspace, newest first (amount in integer minor units, e.g. paise or cents, with currency). These are payment records, not invoice documents: those are in the billing portal. ${NOTE}`,
    input: z.object({ workspaceId, limit: z.number().int().min(1).max(100).default(20) }),
    handler: async (c, a) => ({ payments: await c.deps.billing.payments(c.actor, c.workspaceId, a.limit) }),
  }),
  defineTool({
    name: "get_available_plans", title: "Get available plans", scope: "billing:read", gated: false,
    description: `Plans on offer with prices in integer minor units (amountMinor: paise for INR, cents for USD) and entitlements. ${NOTE}`,
    input: z.object({ workspaceId }),
    handler: async (c) => ({ plans: await c.deps.billing.plans() }),
  }),
  defineTool({
    name: "create_billing_portal_session", title: "Create billing portal link", scope: "billing:portal", gated: false,
    description: "Create a short-lived, single-purpose link to the provider's hosted billing portal where the OWNER can manage payment method, plan and invoices. Owner only. Give the URL to the user; do not open it yourself and do not store it.",
    input: z.object({ workspaceId }),
    handler: async (c) => c.deps.billingPayments.portal(c.actor, c.workspaceId),
  }),
];
