import { NO_CAPABILITIES, type SocialAdapter } from "../core/types.js";
import { createLinkedInAuth } from "./linkedin.auth.js";
import { createLinkedInPublisher } from "./linkedin.publisher.js";

// Capability flags are TRUE only for what is implemented here AND verified in LinkedIn's official docs.
export const LINKEDIN_API_VERSION = "202610"; // Linkedin-Version header (YYYYMM). LinkedIn sunsets versions after ~12 months: bump regularly.

export function createLinkedInAdapter(cfg: { clientId: string; clientSecret: string; apiVersion?: string; pollMs?: number }, f: typeof fetch = fetch): SocialAdapter {
  return {
    platform: "linkedin",
    capabilities: { ...NO_CAPABILITIES, textPost: true, imagePost: true, videoPost: true },
    ...createLinkedInAuth(cfg, f),
    publish: createLinkedInPublisher({ version: cfg.apiVersion ?? LINKEDIN_API_VERSION, ...(cfg.pollMs ? { pollMs: cfg.pollMs } : {}) }, f),
  };
}
