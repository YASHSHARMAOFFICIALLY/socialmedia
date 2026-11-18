import type { Queryable } from "../../infrastructure/database/db.js";

/**
 * Runs when a Google/Microsoft login is linked to an existing user. Better Auth links only when the provider verified
 * the email, so the person signing in owns the address. If the local account never verified it, whoever created it
 * may be a squatter who registered the victim's email first: remove their password, sessions and MCP tokens.
 * A real owner who never clicked the verification link just loses the unverified password (reset works by email).
 */
export async function revokeUnverifiedLocalAccess(db: Queryable, userId: string): Promise<void> {
  const user = await db.query<{ emailVerified: boolean }>(`SELECT "emailVerified" FROM "user" WHERE id = $1`, [userId]);
  if (user.rows[0]?.emailVerified !== false) {
    return;
  }
  await db.query(`DELETE FROM "account" WHERE "userId" = $1 AND "providerId" = 'credential'`, [userId]);
  await db.query(`DELETE FROM "session" WHERE "userId" = $1`, [userId]);
  await db.query("UPDATE mcp_grants SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [userId]);
}
