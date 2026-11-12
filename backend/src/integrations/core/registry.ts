import { AppError } from "../../shared/errors/errors.js";
import { PLATFORMS, type Capabilities, type CredentialField, type Platform, type SocialAdapter } from "./types.js";

export interface AdapterRegistry {
  get(p: string): SocialAdapter;
  list(): { platform: Platform; available: boolean; capabilities: Capabilities | null; connect: "oauth" | "credentials" | null; fields?: CredentialField[] }[];
}

const connectMode = (a?: SocialAdapter) => (!a ? null : a.credentials ? "credentials" as const : "oauth" as const);

/** Only adapters that are implemented AND configured (client credentials present) are registered. */
export function createRegistry(adapters: SocialAdapter[]): AdapterRegistry {
  const map = new Map<string, SocialAdapter>(adapters.map((a) => [a.platform, a]));
  return {
    get(p) {
      const a = map.get(p);
      if (!a) throw new AppError(400, "PLATFORM_UNAVAILABLE", `Platform '${p}' is not available`);
      return a;
    },
    list: () => PLATFORMS.map((platform) => ({ platform, available: map.has(platform), capabilities: map.get(platform)?.capabilities ?? null, connect: connectMode(map.get(platform)), ...(map.get(platform)?.credentials ? { fields: map.get(platform)!.credentials!.fields } : {}) })),
  };
}
