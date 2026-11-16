"use client";

import { useSyncExternalStore } from "react";
import useSWR from "swr";
import { apiUrl } from "@/lib/site";

// The ops token lives in sessionStorage only (gone when the tab closes) and is read through
// useSyncExternalStore, so there is no effect and no hydration mismatch: the server snapshot is
// `undefined` ("not known yet"), the client snapshot is the token or null.
const KEY = "distora.opsToken";
const listeners = new Set<() => void>();
let rejected = false;

function read(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null; // storage blocked: the gate shows and asks again
  }
}

export function setToken(token: string | null, wasRejected = false) {
  try {
    if (token) sessionStorage.setItem(KEY, token);
    else sessionStorage.removeItem(KEY);
  } catch {
    // storage blocked: nothing to persist
  }
  rejected = wasRejected;
  listeners.forEach((l) => l());
}

export const tokenWasRejected = () => rejected;

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export const useOpsToken = () => useSyncExternalStore<string | null | undefined>(subscribe, read, () => undefined);

export class OpsError extends Error {
  constructor(readonly status: number) {
    super(status === 0 ? "Can't reach the API." : `The API answered ${status}.`);
  }
}

async function opsFetch<T>([path, token]: readonly [string, string]): Promise<T> {
  let r: Response;
  try {
    // No cookies: the bearer token is the only credential.
    r = await fetch(`${apiUrl}${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  } catch {
    throw new OpsError(0);
  }
  if (!r.ok) throw new OpsError(r.status);
  return r.json() as Promise<T>;
}

/** Owner dashboard data. Refreshes every 30s; a 401 drops the token and sends the owner back to the gate. */
export function useOps<T>(path: string | null, token: string) {
  return useSWR<T, OpsError>(path ? ([path, token] as const) : null, opsFetch<T>, {
    refreshInterval: 30_000,
    keepPreviousData: true,
    revalidateOnFocus: false,
    onError: (e) => {
      if (e.status === 401 || e.status === 404) setToken(null, true);
    },
  });
}

// ---- Response shapes (backend/src/modules/ops/ops.routes.ts) ----
type N = number | null;
export interface Overview {
  data: {
    generatedAt: string;
    status: {
      overall: "ok" | "degraded" | "down";
      reasons: string[];
      api: "up";
      db: { ok: boolean; latencyMs: N };
      workers: Record<"publishing" | "analytics" | "scheduling", { alive: boolean; lastBeatSecondsAgo?: number }> | null;
      backlog: { outboxDue: N; outboxOldestS: N; jobsDue: N } | null;
      errorRate1h: { requests: N; errors5xx: N; rate: N };
      metricsSince: string | null;
    };
    database: { sizeBytes: N; planName: string; planLimitBytes: number; planLimitSource: string; latencyMs: N; tables: { name: string; totalBytes: number; rows: number }[] | null };
    queues: {
      jobs: { pending: N; pendingDue: N; scheduled: N; leased: N; leaseExpired: N; reconciling: N; failed24h: N; exhausted24h: N; oldestPendingAgeS: N } | null;
      outbox: { due: N; oldestDueS: N } | null;
      dlq: { queue: string; last24h: number; last7d: number }[] | null;
      recentFailures: { jobId: string; platform: string; workspaceId: string; code: string | null; message: string | null; at: string }[] | null;
    };
    business: {
      users: N; usersLast7d: N; workspaces: N;
      accountsByPlatform: { platform: string; active: number; needsReauth: number; disconnected: number }[] | null;
      publishingByPlatform: { platform: string; published24h: number; failed24h: number; published7d: number; failed7d: number; successRate7d: N }[] | null;
      subscriptions: { plan: string; status: string; n: number }[] | null;
      billingWebhooksFailed: N;
    };
    storage: { source: string; trackedObjects: N; trackedBytes: N } | null;
    costs: { estimate: true; currency: "USD"; pricesAsOf: string; items: { key: string; label: string; usd: number; basis: string }[]; totalUsd: number; notTracked: string[]; requestsPerMonthProjected: number };
  };
}
export interface Summary { count: number; errors5xx: number; errors4xx: number; errorRate: N; avgMs: N; p50: N; p95: N; p99: N }
export interface Metrics {
  data: { range: string; binSeconds: number; totals: Summary; groups: (Summary & { group: string })[]; series: { t: string; count: number; errors5xx: number; p50: N; p95: N }[] };
}
export interface AuditPage {
  data: { id: string; workspaceId: string | null; workspaceName: string | null; actorId: string | null; actorEmail: string | null; actorName: string | null; action: string; targetType: string | null; targetId: string | null; requestId: string | null; at: string }[];
  meta: { nextBefore: number | null; actions: { action: string; n: number }[] };
}
export interface ErrorPage {
  data: { id: string; source: "http" | "dlq"; route: string; method: string | null; requestId: string | null; message: string; at: string }[];
  meta: { nextBefore: number | null };
}
