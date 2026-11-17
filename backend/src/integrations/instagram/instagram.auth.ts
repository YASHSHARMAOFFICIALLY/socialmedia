import { badRequest } from "../../shared/errors/errors.js";
import { PlatformError } from "../core/errors.js";
import { metaFetch } from "../core/http.js";
import type { ConnectedAccount, SocialAdapter } from "../core/types.js";
import { GRAPH, V, facebookUserId, longLivedUserToken } from "../facebook/facebook.adapter.js";

// "Instagram API with Facebook Login" (Meta stopped offering "Instagram API with Instagram Login" to new apps).
// Verified (developers.facebook.com Instagram Platform docs, v27.0): the user logs in through the Facebook Login dialog; the code becomes a
// long-lived Facebook user token; GET /me/accounts lists the Pages they manage with each Page's access token and its linked
// instagram_business_account; the IG user id + the PAGE access token are what get stored ("Content Publishing" requires a Page token).
// Facebook Login for Business: config_id replaces scope ("scope can still be included, we recommend that you do not use it").
// Page tokens derived from a long-lived user token do not expire, so there is no refresh.
export const INSTAGRAM_SCOPES = ["instagram_basic", "instagram_content_publish", "instagram_manage_insights", "pages_show_list", "pages_read_engagement", "business_management"];
export { GRAPH };

type Page = { id: string; name: string; access_token?: string; instagram_business_account?: { id: string; username?: string; profile_picture_url?: string } };

export function createInstagramAuth(cfg: { clientId: string; clientSecret: string; configId?: string | undefined }, f: typeof fetch = fetch): Pick<SocialAdapter, "oauth" | "fetchAccount" | "listAccounts"> {
  return {
    oauth: {
      usesPkce: false,
      authorizationUrl: ({ state, redirectUri }) => `https://www.facebook.com/${V}/dialog/oauth?${new URLSearchParams({
        client_id: cfg.clientId, redirect_uri: redirectUri, response_type: "code", state, ...(cfg.configId ? { config_id: cfg.configId } : { scope: INSTAGRAM_SCOPES.join(",") }),
      })}`,
      async exchangeCode({ code, redirectUri }) {
        return { accessToken: await longLivedUserToken(f, "instagram", cfg, code, redirectUri), scopes: INSTAGRAM_SCOPES }; // only used to list Pages
      },
    },
    async fetchAccount(): Promise<never> { throw new PlatformError("permanent", "instagram connects through listAccounts"); },
    async listAccounts(tokens): Promise<ConnectedAccount[]> {
      const fbUserId = await facebookUserId(f, "instagram", tokens.accessToken);
      const fields = "id,name,access_token,instagram_business_account{id,username,profile_picture_url}";
      const r = await metaFetch(f, "instagram", `${GRAPH}/me/accounts?${new URLSearchParams({ fields, limit: "100" })}`, { headers: { authorization: `Bearer ${tokens.accessToken}` } });
      const pages = ((await r.json()) as { data?: Page[] }).data ?? [];
      const found = pages.filter((p) => p.access_token && p.instagram_business_account?.id).map((p) => {
        const ig = p.instagram_business_account!;
        return {
          profile: { externalId: ig.id, displayName: ig.username ?? p.name, ...(ig.username ? { username: ig.username } : {}), ...(ig.profile_picture_url ? { avatarUrl: ig.profile_picture_url } : {}), accountType: "business" as const, metadata: { pageId: p.id, fbUserId } },
          tokens: { accessToken: p.access_token!, scopes: tokens.scopes },
        };
      });
      if (found.length === 0) throw badRequest("None of the Facebook Pages you granted has a linked Instagram professional account. Link your Instagram Business/Creator account to a Facebook Page, then connect again and select that Page.");
      return found;
    },
  };
}
