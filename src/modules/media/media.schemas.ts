import { z } from "zod";

export const MIME_KIND: Record<string, "image" | "video"> = {
  "image/jpeg": "image", "image/png": "image", "image/gif": "image", "image/webp": "image",
  "video/mp4": "video", "video/quicktime": "video", "video/webm": "video",
};
// Global upload caps (platform limits are enforced separately by per-platform rules). 4 GiB stays under a single R2 PUT.
export const MAX_BYTES = { image: 25 * 1024 * 1024, video: 4 * 1024 ** 3 } as const;

export const wsParam = z.object({ workspaceId: z.uuid() });
export const mediaParams = wsParam.extend({ mediaId: z.uuid() });
export const uploadBody = z.object({
  filename: z.string().trim().min(1).max(200).regex(/^[^/\\\0]+$/, "Invalid filename"),
  contentType: z.enum(Object.keys(MIME_KIND) as [string, ...string[]]),
  sizeBytes: z.number().int().positive(),
}).superRefine((v, ctx) => {
  const max = MAX_BYTES[MIME_KIND[v.contentType]!];
  if (v.sizeBytes > max) ctx.addIssue({ code: "custom", path: ["sizeBytes"], message: `Maximum size for ${MIME_KIND[v.contentType]} files is ${max} bytes` });
});
export const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(500).optional(),
  kind: z.enum(["image", "video"]).optional(),
  status: z.enum(["pending_upload", "uploaded", "ready", "failed"]).optional(),
  q: z.string().trim().max(100).optional(),
  unused: z.enum(["true", "false"]).optional(),
});

export const derivativeBody = z.object({
  format: z.enum(["jpeg", "png", "webp"]),
  maxWidth: z.number().int().min(16).max(8192).optional(),
  maxHeight: z.number().int().min(16).max(8192).optional(),
  fit: z.enum(["scale-down", "contain", "cover"]).default("scale-down"),
  quality: z.number().int().min(30).max(100).default(85),
});
