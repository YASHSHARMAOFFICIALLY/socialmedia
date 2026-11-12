import type { AdapterRegistry } from "../../integrations/core/registry.js";
import type { ContentInput, ContentRules, Issue } from "../../integrations/core/rules.js";
import type { Platform } from "../../integrations/core/types.js";
import { toMediaInput, type PostMediaRow, type PostRow, type VariantRow } from "./content.repository.js";

export interface VariantReport {
  accountId: string; platform: string; accountName: string; valid: boolean; issues: Issue[];
  /** false when the platform adapter is not configured or the needed capability is not verified/implemented yet. */
  publishable: boolean; publishBlockers: string[];
}
export interface ValidationReport { valid: boolean; publishable: boolean; issues: Issue[]; variants: VariantReport[] }

/** Fills inherited fields so platform rules see exactly what would be sent. */
export function resolveVariant(post: PostRow, v: VariantRow, media: PostMediaRow[]): ContentInput {
  const own = media.filter((m) => m.variant_id === v.id);
  const chosen = own.length > 0 ? own : media.filter((m) => m.variant_id === null);
  return {
    text: v.caption ?? post.body,
    title: v.title ?? post.title,
    description: v.description,
    hashtags: v.hashtags ?? post.hashtags,
    media: chosen.map(toMediaInput),
    metadata: v.metadata,
  };
}

export function validatePost(post: PostRow, variants: VariantRow[], media: PostMediaRow[], rules: Record<Platform, ContentRules>, registry: AdapterRegistry): ValidationReport {
  const postIssues: Issue[] = [];
  if (variants.length === 0) postIssues.push({ code: "NO_DESTINATIONS", field: "variants", severity: "error", message: "Select at least one destination account" });
  const caps = new Map(registry.list().map((p) => [p.platform, p]));

  const reports = variants.map((v): VariantReport => {
    const input = resolveVariant(post, v, media);
    const issues = rules[v.platform as Platform].validate(input);
    const blockers: string[] = [];
    const info = caps.get(v.platform as Platform);
    if (v.account_status !== "active") blockers.push(`Account is ${v.account_status}; reconnect it`);
    if (!info?.available) blockers.push("Platform integration is not configured");
    else {
      const c = info.capabilities!;
      const videos = input.media.some((m) => m.kind === "video"), images = input.media.some((m) => m.kind === "image");
      if (videos && !c.videoPost) blockers.push("Video publishing is not enabled for this platform yet");
      else if (images && !c.imagePost) blockers.push("Image publishing is not enabled for this platform yet");
      else if (!videos && !images && !c.textPost) blockers.push("Text publishing is not enabled for this platform yet");
    }
    if (issues.some((i) => i.severity === "error")) blockers.push("Content has validation errors");
    return { accountId: v.social_account_id, platform: v.platform, accountName: v.account_name, valid: !issues.some((i) => i.severity === "error"), issues, publishable: blockers.length === 0, publishBlockers: blockers };
  });
  const valid = !postIssues.some((i) => i.severity === "error") && reports.every((r) => r.valid);
  return { valid, publishable: valid && reports.every((r) => r.publishable), issues: postIssues, variants: reports };
}
