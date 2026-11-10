import { z } from "zod";

const tag = z.string().trim().min(1).max(100).regex(/^#?[\p{L}\p{N}_]+$/u, "Hashtags may contain letters, numbers and underscores").transform((t) => t.replace(/^#/, ""));
const tags = z.array(tag).max(60);
const label = z.string().trim().min(1).max(50);
export const mediaRef = z.object({ mediaId: z.uuid(), role: z.enum(["media", "thumbnail"]).default("media") });
export const variantInput = z.object({
  accountId: z.uuid(),
  caption: z.string().max(25_000).nullable().optional(),
  title: z.string().max(300).nullable().optional(),
  description: z.string().max(25_000).nullable().optional(),
  hashtags: tags.nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  media: z.array(mediaRef).max(20).nullable().optional(),   // null/omitted => inherit post media
});
export const createPostBody = z.object({
  title: z.string().trim().max(300).optional(),
  body: z.string().max(25_000).default(""),
  hashtags: tags.default([]),
  labels: z.array(label).max(20).default([]),
  media: z.array(mediaRef).max(20).default([]),
  variants: z.array(variantInput).max(20).default([]),
});
export const updatePostBody = z.object({
  title: z.string().trim().max(300).nullable().optional(),
  body: z.string().max(25_000).optional(),
  hashtags: tags.optional(),
  labels: z.array(label).max(20).optional(),
  media: z.array(mediaRef).max(20).optional(),
}).refine((v) => Object.keys(v).length > 0, "Nothing to update");
export const wsParam = z.object({ workspaceId: z.uuid() });
export const postParams = wsParam.extend({ postId: z.uuid() });
export const variantParams = postParams.extend({ accountId: z.uuid() });
export const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(500).optional(),
  status: z.enum(["draft", "submitted"]).optional(),
  label: z.string().max(50).optional(),
  q: z.string().trim().max(100).optional(),
});
export type VariantInput = z.infer<typeof variantInput>;
