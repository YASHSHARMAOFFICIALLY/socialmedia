import type { Queryable } from "../../infrastructure/database/db.js";

/** Entitlement gate injected into services. A no-op unless BILLING_ENFORCE=true, so turning billing on is a deliberate, separate step. */
/** `at` is when the gated thing happens (a scheduled post's run time): monthly limits count against that month. */
export type Gate = (workspaceId: string, feature: string, quantity?: number, q?: Queryable, at?: Date) => Promise<unknown>;
export const noGate: Gate = async () => undefined;
