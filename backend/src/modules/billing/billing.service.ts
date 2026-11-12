import type { Db, Queryable } from "../../infrastructure/database/db.js";
import { AppError } from "../../shared/errors/errors.js";
import type { Actor, WorkspaceService } from "../workspaces/workspace.service.js";
import { GRANTS_ACCESS, type SubStatus } from "./billing.state.js";

type Kind = "flag" | "value" | "count" | "metered";
interface Row { feature_key: string; kind: Kind; limit_value: string | null }
export interface Check { feature: string; allowed: boolean; kind: Kind; limit: number | null; used: number; remaining: number | null; plan: string; reason?: string }

/** Live resource counts (what a workspace currently has). Metered features count usage events instead. */
const COUNTS: Record<string, string> = {
  connected_accounts: "SELECT count(*)::int AS n FROM social_accounts WHERE workspace_id = $1 AND status <> 'disconnected'",
  seats: "SELECT count(*)::int AS n FROM workspace_members WHERE workspace_id = $1",
};
const monthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

export function createBillingService(deps: { db: Db; workspaces: WorkspaceService }) {
  const { db, workspaces } = deps;

  /** The plan version that applies to a workspace right now: its live paid subscription, else the active Free version. */
  async function current(workspaceId: string, q: Queryable = db) {
    const sub = (await q.query<{ id: string; status: SubStatus; plan_version_id: string; currency: string; interval: string; current_period_end: string | null; cancel_at_period_end: boolean }>(
      "SELECT id, status, plan_version_id, currency, interval, current_period_end, cancel_at_period_end FROM billing_subscriptions WHERE workspace_id = $1 AND status <> 'canceled'", [workspaceId])).rows[0];
    const granting = sub && GRANTS_ACCESS.has(sub.status) ? sub : undefined;
    const pv = (await q.query<{ id: string; key: string; name: string; version: number }>(
      granting
        ? "SELECT v.id, p.key, p.name, v.version FROM billing_plan_versions v JOIN billing_plans p ON p.id = v.plan_id WHERE v.id = $1"
        : "SELECT v.id, p.key, p.name, v.version FROM billing_plan_versions v JOIN billing_plans p ON p.id = v.plan_id WHERE p.key = 'free' AND v.active ORDER BY v.version DESC LIMIT 1",
      granting ? [granting.plan_version_id] : [])).rows[0]!;
    return { plan: pv, subscription: sub ?? null };
  }

  async function used(workspaceId: string, feature: string, kind: Kind, q: Queryable): Promise<number> {
    if (kind === "metered" && feature === "posts_per_month") {
      // Published this period PLUS jobs already accepted (pending/scheduled-in-period/processing) that have not published yet:
      // otherwise any number of posts could be scheduled before the first one runs.
      const start = monthStart(), end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
      return (await q.query<{ n: number }>(
        `SELECT (COALESCE((SELECT sum(quantity) FROM billing_usage_events WHERE workspace_id = $1 AND feature_key = $2 AND occurred_at >= $3), 0)
               + (SELECT count(*) FROM publishing_jobs j WHERE j.workspace_id = $1 AND j.status IN ('pending','scheduled','processing') AND j.next_attempt_at < $4
                    AND NOT EXISTS (SELECT 1 FROM billing_usage_events u WHERE u.workspace_id = j.workspace_id AND u.idempotency_key = 'published:' || j.id::text)))::int AS n`,
        [workspaceId, feature, start, end])).rows[0]!.n;
    }
    if (kind === "metered") {
      return (await q.query<{ n: number }>("SELECT COALESCE(sum(quantity), 0)::int AS n FROM billing_usage_events WHERE workspace_id = $1 AND feature_key = $2 AND occurred_at >= $3", [workspaceId, feature, monthStart()])).rows[0]!.n;
    }
    const sql = COUNTS[feature];
    return sql ? (await q.query<{ n: number }>(sql, [workspaceId])).rows[0]!.n : 0;
  }

  async function entitlements(workspaceId: string, q: Queryable = db) {
    const { plan, subscription } = await current(workspaceId, q);
    const rows = (await q.query<Row>("SELECT feature_key, kind, limit_value::text FROM billing_entitlements WHERE plan_version_id = $1 ORDER BY feature_key", [plan.id])).rows;
    return { plan, subscription, rows };
  }

  /** THE entitlement decision. Every feature gate (REST, MCP, workers) must go through here; nothing else reads plan limits. */
  async function check(workspaceId: string, feature: string, quantity = 1, q: Queryable = db): Promise<Check> {
    const { plan, rows } = await entitlements(workspaceId, q);
    const e = rows.find((r) => r.feature_key === feature);
    if (!e) return { feature, allowed: false, kind: "flag", limit: 0, used: 0, remaining: 0, plan: plan.key, reason: "not_in_plan" };
    const limit = e.limit_value === null ? null : Number(e.limit_value);
    if (e.kind === "flag" || e.kind === "value") {
      const allowed = e.kind === "value" ? true : limit === 1;
      return { feature, allowed, kind: e.kind, limit, used: 0, remaining: null, plan: plan.key, ...(allowed ? {} : { reason: "not_in_plan" }) };
    }
    const u = await used(workspaceId, feature, e.kind, q);
    const allowed = limit === null || u + quantity <= limit;
    return { feature, allowed, kind: e.kind, limit, used: u, remaining: limit === null ? null : Math.max(0, limit - u), plan: plan.key, ...(allowed ? {} : { reason: "limit_reached" }) };
  }

  /** 402 when the plan does not allow it. The error carries the numbers, never anything about payment providers. */
  async function enforce(workspaceId: string, feature: string, quantity = 1, q: Queryable = db) {
    const c = await check(workspaceId, feature, quantity, q);
    if (!c.allowed) throw new AppError(402, "PLAN_LIMIT_REACHED", `Your plan does not allow this (${feature}: ${c.reason})`, { feature, limit: c.limit, used: c.used, plan: c.plan });
    return c;
  }

  return {
    check, enforce, entitlements, current,

    /** Idempotent: the same key records once. Returns whether THIS call recorded it. */
    async recordUsage(workspaceId: string, feature: string, quantity: number, idempotencyKey: string, q: Queryable = db) {
      const r = await q.query("INSERT INTO billing_usage_events (workspace_id, feature_key, quantity, idempotency_key) VALUES ($1,$2,$3,$4) ON CONFLICT (workspace_id, idempotency_key) DO NOTHING", [workspaceId, feature, quantity, idempotencyKey]);
      return { recorded: (r.rowCount ?? 0) > 0 };
    },

    /** Payments the provider reported (not full invoices: those live in the provider's billing portal). Newest first. */
    async payments(a: Actor, workspaceId: string, limit = 20) {
      await workspaces.authorize(a.id, workspaceId, "billing:read");
      return (await db.query<{ id: string; status: string; amount_minor: string | null; currency: string | null; occurred_at: string }>(
        "SELECT id, status, amount_minor::text, currency, occurred_at FROM billing_payments WHERE workspace_id = $1 ORDER BY occurred_at DESC, id LIMIT $2", [workspaceId, Math.min(Math.max(limit, 1), 100)])).rows
        .map((r) => ({ id: r.id, status: r.status, amountMinor: r.amount_minor === null ? null : Number(r.amount_minor), currency: r.currency, occurredAt: r.occurred_at }));
    },

    /** Catalog of purchasable plans (active versions) with prices in minor units. */
    async plans() {
      const rows = (await db.query<{ key: string; name: string; version: number; currency: string | null; interval: string | null; amount_minor: string | null }>(
        `SELECT p.key, p.name, v.version, pr.currency, pr.interval, pr.amount_minor::text FROM billing_plans p
           JOIN billing_plan_versions v ON v.plan_id = p.id AND v.active LEFT JOIN billing_prices pr ON pr.plan_version_id = v.id ORDER BY p.position, pr.currency`)).rows;
      const ents = (await db.query<Row & { key: string }>("SELECT p.key, e.feature_key, e.kind, e.limit_value::text FROM billing_entitlements e JOIN billing_plan_versions v ON v.id = e.plan_version_id AND v.active JOIN billing_plans p ON p.id = v.plan_id ORDER BY e.feature_key")).rows;
      const out = new Map<string, { key: string; name: string; version: number; prices: { currency: string; interval: string; amountMinor: number }[]; entitlements: Record<string, { kind: Kind; limit: number | null }> }>();
      for (const r of rows) {
        const e = out.get(r.key) ?? { key: r.key, name: r.name, version: r.version, prices: [], entitlements: {} };
        if (r.currency) e.prices.push({ currency: r.currency, interval: r.interval!, amountMinor: Number(r.amount_minor) });
        out.set(r.key, e);
      }
      for (const e of ents) out.get(e.key)!.entitlements[e.feature_key] = { kind: e.kind, limit: e.limit_value === null ? null : Number(e.limit_value) };
      return [...out.values()];
    },

    /** Current plan, subscription state and per-feature usage for a workspace. */
    async overview(a: Actor, workspaceId: string) {
      await workspaces.authorize(a.id, workspaceId, "billing:read");
      const { plan, subscription, rows } = await entitlements(workspaceId);
      const features = await Promise.all(rows.map(async (r) => {
        const limit = r.limit_value === null ? null : Number(r.limit_value);
        const u = r.kind === "count" || r.kind === "metered" ? await used(workspaceId, r.feature_key, r.kind, db) : null;
        return { feature: r.feature_key, kind: r.kind, limit, used: u, remaining: u === null || limit === null ? null : Math.max(0, limit - u) };
      }));
      return {
        plan: { key: plan.key, name: plan.name, version: plan.version },
        subscription: subscription ? { status: subscription.status, currency: subscription.currency, interval: subscription.interval, currentPeriodEnd: subscription.current_period_end, cancelAtPeriodEnd: subscription.cancel_at_period_end } : null,
        usagePeriodStart: monthStart().toISOString(), features,
      };
    },
  };
}
export type BillingService = ReturnType<typeof createBillingService>;
