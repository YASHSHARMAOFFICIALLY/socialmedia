import type { Db } from "../infrastructure/database/db.js";

/** Hourly housekeeping for tables that would otherwise grow forever. Each statement is independent and idempotent. */
export async function purgeOldRows(db: Db) {
  const del = async (sql: string) => (await db.query(sql)).rowCount;
  return {
    idempotencyKeys: await del("DELETE FROM idempotency_keys WHERE created_at < now() - interval '7 days'"),
    rateLimits: await del("DELETE FROM rate_limits WHERE window_start < extract(epoch from now())::bigint - 86400"),
    oauthStates: await del("DELETE FROM oauth_states WHERE expires_at < now() - interval '1 day'"),
    // dispatched outbox rows and old worker heartbeats carry no information once delivered
    outbox: await del("DELETE FROM outbox_events WHERE dispatched_at < now() - interval '14 days'"),
    expiredInvitations: await del("DELETE FROM workspace_invitations WHERE expires_at < now() - interval '30 days' AND accepted_at IS NULL"),
  };
}
