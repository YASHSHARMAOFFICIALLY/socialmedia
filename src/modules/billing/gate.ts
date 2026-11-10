import type { Queryable } from "../../infrastructure/database/db.js";

/** Entitlement gate injected into services. A no-op unless BILLING_ENFORCE=true, so turning billing on is a deliberate, separate step. */
export type Gate = (workspaceId: string, feature: string, quantity?: number, q?: Queryable) => Promise<unknown>;
export const noGate: Gate = async () => undefined;
