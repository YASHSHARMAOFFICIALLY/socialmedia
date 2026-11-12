import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "../../infrastructure/database/db.js";
import type { ObjectStorage } from "../../infrastructure/storage/storage.js";
import type { ContentRules } from "../../integrations/core/rules.js";
import type { Platform } from "../../integrations/core/types.js";
import { AppError, notFound } from "../../shared/errors/errors.js";
import { decodeCursor, page } from "../../shared/utils/pagination.js";
import { auditRepository } from "../audit/audit.repository.js";
import type { Actor, WorkspaceService } from "../workspaces/workspace.service.js";
import { mediaRepository as repo, type MediaRow } from "./media.repository.js";
import type { ImageTransformer } from "../../infrastructure/storage/image-transform.js";
import { readMp4Meta } from "./media.mp4.js";
import { MEDIA_TRANSFORM_MAX_INPUT_BYTES, MEDIA_TRANSFORM_MAX_OUTPUT_S, type VideoTransformer, type VideoTransformOptions } from "../../infrastructure/storage/video-transform.js";
import { imageDimensions, sniffMime } from "./media.sniff.js";
import { MIME_KIND } from "./media.schemas.js";

const cursorSchema = z.object({ createdAt: z.string(), id: z.string() });
const UPLOAD_TTL_S = 3600, DOWNLOAD_TTL_S = 3600, SNIFF_BYTES = 256 * 1024;
const ext = (name: string) => /\.[A-Za-z0-9]{1,8}$/.exec(name)?.[0].toLowerCase() ?? "";
const publicView = ({ storage_key: _k, workspace_id: _w, ...m }: MediaRow) => m;

export function createMediaService(deps: { db: Db; workspaces: WorkspaceService; storage: ObjectStorage | null; rules: Record<Platform, ContentRules>; images?: ImageTransformer | null; videos?: VideoTransformer | null }) {
  const { db, workspaces } = deps;
  const storage = () => { if (!deps.storage) throw new AppError(503, "MEDIA_STORAGE_NOT_CONFIGURED", "Object storage is not configured"); return deps.storage; };

  return {
    /** Step 1: register the asset and hand the client a presigned PUT URL (content type is part of the signature). */
    async createUpload(a: Actor, workspaceId: string, i: { filename: string; contentType: string; sizeBytes: number }) {
      await workspaces.authorize(a.id, workspaceId, "media:write");    // authorize BEFORE revealing configuration state
      const st = storage();
      const id = randomUUID();
      const key = `${workspaceId}/${id}${ext(i.filename)}`;     // user input never appears in the key except a sanitized extension
      const row = await repo.create(db, { id, workspaceId, kind: MIME_KIND[i.contentType]!, key, filename: i.filename, mime: i.contentType, size: i.sizeBytes, userId: a.id });
      const put = await st.presignPut(key, { contentType: i.contentType, expiresS: UPLOAD_TTL_S });
      return { media: publicView(row), upload: { method: "PUT" as const, url: put.url, headers: put.headers, expiresAt: new Date(Date.now() + UPLOAD_TTL_S * 1000).toISOString() } };
    },

    /** Step 2: verify what was actually uploaded (size, real content type) before the asset can be attached to a post. */
    async confirm(a: Actor, workspaceId: string, mediaId: string) {
      await workspaces.authorize(a.id, workspaceId, "media:write");
      const st = storage();
      const m = await repo.get(db, workspaceId, mediaId);
      if (!m) throw notFound("Media");
      if (m.status === "ready") return publicView(m);
      if (m.status !== "pending_upload" && m.status !== "uploaded") throw new AppError(409, "MEDIA_NOT_CONFIRMABLE", `Media is ${m.status}`);
      const reject = async (code: string, message: string) => {
        await repo.setFailed(db, workspaceId, mediaId);
        await st.delete(m.storage_key).catch(() => {});              // never keep a rejected object
        throw new AppError(422, code, message);
      };
      const head = await st.head(m.storage_key);
      if (!head) throw new AppError(409, "UPLOAD_MISSING", "No uploaded file found: upload to the signed URL first");
      if (head.size !== Number(m.size_bytes)) return reject("SIZE_MISMATCH", `Uploaded ${head.size} bytes but ${m.size_bytes} were declared`);
      const bytes = await st.readRange(m.storage_key, 0, Math.min(head.size, SNIFF_BYTES) - 1);
      const real = sniffMime(bytes);
      if (real !== m.mime_type) return reject("MIME_MISMATCH", `File content is ${real ?? "unrecognized"}, not the declared ${m.mime_type}`);
      let video = null;
      if (m.kind === "video" && (real === "video/mp4" || real === "video/quicktime"))
        video = await readMp4Meta((a, b) => st.readRange(m.storage_key, a, b), head.size).catch(() => null);   // best effort: unknown duration just skips duration rules
      await repo.setReady(db, workspaceId, mediaId, m.kind === "image" ? imageDimensions(bytes, real) : video && video.width && video.height ? { width: video.width, height: video.height } : null, video?.durationMs ?? null);
      await auditRepository.record(db, { workspaceId, actorId: a.id, action: "media.uploaded", entityType: "media", entityId: mediaId, ...(a.requestId ? { requestId: a.requestId } : {}) });
      return publicView((await repo.get(db, workspaceId, mediaId))!);
    },

    async list(a: Actor, workspaceId: string, f: { limit: number; cursor?: string | undefined; kind?: string | undefined; status?: string | undefined; q?: string | undefined; unused?: "true" | "false" | undefined }) {
      await workspaces.authorize(a.id, workspaceId, "media:read");
      const rows = (await repo.list(db, workspaceId, { ...f, unused: f.unused === undefined ? undefined : f.unused === "true", after: decodeCursor(f.cursor, cursorSchema) })).rows;
      return page(rows, f.limit, (r) => ({ createdAt: r.created_at, id: r.id }));
    },

    async get(a: Actor, workspaceId: string, mediaId: string) {
      await workspaces.authorize(a.id, workspaceId, "media:read");
      const m = await repo.get(db, workspaceId, mediaId);
      if (!m) throw notFound("Media");
      const downloadUrl = m.status === "ready" && deps.storage ? await deps.storage.presignGet(m.storage_key, DOWNLOAD_TTL_S) : null;
      return { ...publicView(m), usage_count: await repo.usageCount(db, workspaceId, mediaId), downloadUrl };
    },

    /** Never assume one file fits every platform: run each platform's media rules against this single asset. */
    async compatibility(a: Actor, workspaceId: string, mediaId: string) {
      await workspaces.authorize(a.id, workspaceId, "media:read");
      const m = await repo.get(db, workspaceId, mediaId);
      if (!m) throw notFound("Media");
      const media = { kind: m.kind, role: "media" as const, mimeType: m.mime_type, sizeBytes: Number(m.size_bytes), width: m.width, height: m.height, durationMs: m.duration_ms };
      return Object.fromEntries((Object.keys(deps.rules) as Platform[]).map((p) => {
        const issues = deps.rules[p].validate({ text: "", title: "x", description: null, hashtags: [], media: [media], metadata: {} }).filter((i) => i.field === "media");
        const fixes = m.kind === "image" && issues.some((i) => i.code === "IMAGE_FORMAT") ? [{ action: "create_derivative", format: "jpeg", via: `POST /workspaces/${workspaceId}/media/${mediaId}/derivatives` }] : [];
        const tooBig = m.kind === "video" && issues.some((i) => i.severity === "error" && /VIDEO_(TOO_LARGE|SIZE)/.test(i.code));
        if (tooBig && !fixes.length) fixes.push({ action: "create_video_derivative", format: "mp4", via: `POST /workspaces/${workspaceId}/media/${mediaId}/video-derivatives` } as never);
        return [p, { compatible: !issues.some((i) => i.severity === "error"), issues, ...(fixes.length ? { fixes } : {}) }];
      }));
    },

    /**
     * Creates a converted/resized copy of an image as a new asset (e.g. JPEG for Instagram, or a 1280px thumbnail). The original is untouched.
     * The result is verified like any upload (real type from magic bytes, dimensions) before it becomes usable.
     */
    async createDerivative(a: Actor, workspaceId: string, mediaId: string, o: { format: "jpeg" | "png" | "webp"; maxWidth?: number | undefined; maxHeight?: number | undefined; fit: "scale-down" | "contain" | "cover"; quality: number }) {
      await workspaces.authorize(a.id, workspaceId, "media:write");
      const st = storage();
      const src = await repo.get(db, workspaceId, mediaId);
      if (!src) throw notFound("Media");
      if (src.kind !== "image" || src.status !== "ready") throw new AppError(409, "MEDIA_NOT_CONVERTIBLE", "Only confirmed images can be converted");
      if (!deps.images) throw new AppError(503, "IMAGE_TRANSFORM_UNAVAILABLE", "Image transformation is not available in this deployment (it needs Cloudflare Images transformations)");
      let out: { bytes: Uint8Array; contentType: string };
      try { out = await deps.images.transform(await st.presignGet(src.storage_key, 300), { format: o.format, width: o.maxWidth, height: o.maxHeight, fit: o.fit, quality: o.quality }); }
      catch { throw new AppError(502, "IMAGE_TRANSFORM_FAILED", "The image could not be transformed"); }
      const mime = `image/${o.format}`, real = sniffMime(out.bytes);
      if (real !== mime) throw new AppError(502, "IMAGE_TRANSFORM_FAILED", "The transformation returned an unexpected file type");
      if (out.bytes.length > 25 * 1024 * 1024) throw new AppError(502, "IMAGE_TRANSFORM_FAILED", "The converted image is too large");
      const id = randomUUID(), key = `${workspaceId}/${id}.${o.format === "jpeg" ? "jpg" : o.format}`;
      await st.put(key, out.bytes, mime);
      const dims = imageDimensions(out.bytes, mime);
      const row = await repo.create(db, { id, workspaceId, kind: "image", key, filename: src.filename.replace(/\.[^.]+$/, "") + `.${o.format === "jpeg" ? "jpg" : o.format}`, mime, size: out.bytes.length, userId: a.id, derivedFrom: mediaId, derivation: { ...o }, status: "ready", width: dims?.width ?? null, height: dims?.height ?? null });
      await auditRepository.record(db, { workspaceId, actorId: a.id, action: "media.derived", entityType: "media", entityId: id, metadata: { from: mediaId, format: o.format }, ...(a.requestId ? { requestId: a.requestId } : {}) });
      return publicView(row);
    },

    /**
     * Creates a re-encoded (H.264/AAC MP4), downscaled copy of a video as a new asset; the original is untouched. Needs Cloudflare Media
     * Transformations: input under 100 MB and 10 minutes, output at most 60 seconds (so longer videos can only be cut, never fully converted).
     * The result is verified like an upload (real container from magic bytes, dimensions/duration read from the file) before it becomes usable.
     */
    async createVideoDerivative(a: Actor, workspaceId: string, mediaId: string, o: { maxWidth?: number | undefined; maxHeight?: number | undefined; fit: VideoTransformOptions["fit"]; startSeconds?: number | undefined; maxSeconds?: number | undefined; audio: boolean }) {
      await workspaces.authorize(a.id, workspaceId, "media:write");
      const st = storage();
      const src = await repo.get(db, workspaceId, mediaId);
      if (!src) throw notFound("Media");
      if (src.kind !== "video" || src.status !== "ready") throw new AppError(409, "MEDIA_NOT_CONVERTIBLE", "Only confirmed videos can be converted");
      if (!deps.videos) throw new AppError(503, "VIDEO_TRANSFORM_UNAVAILABLE", "Video transformation is not available in this deployment (it needs Cloudflare Media Transformations on a zone, MEDIA_TRANSFORM_ORIGIN)");
      if (Number(src.size_bytes) > MEDIA_TRANSFORM_MAX_INPUT_BYTES) throw new AppError(422, "VIDEO_TOO_LARGE_TO_CONVERT", "Videos over 100 MB cannot be converted by the transformation service");
      const knownS = src.duration_ms != null ? src.duration_ms / 1000 : null;
      if (knownS !== null && knownS > 600) throw new AppError(422, "VIDEO_TOO_LONG_TO_CONVERT", "Videos over 10 minutes cannot be converted by the transformation service");
      const cut = (o.startSeconds ?? 0) > 0 || o.maxSeconds !== undefined;
      // One request yields at most 60 s. Converting a longer video without saying how much to keep would silently cut it: refuse instead.
      if (!cut && (knownS === null || knownS > MEDIA_TRANSFORM_MAX_OUTPUT_S)) throw new AppError(422, "VIDEO_CUT_REQUIRED", `The transformation service outputs at most ${MEDIA_TRANSFORM_MAX_OUTPUT_S} seconds. Pass maxSeconds (and optionally startSeconds) to keep a part of this video`);
      let out: { bytes: Uint8Array; contentType: string };
      try { out = await deps.videos.transform(await st.presignGet(src.storage_key, 900), { width: o.maxWidth, height: o.maxHeight, fit: o.fit, durationS: o.maxSeconds ?? (knownS !== null ? Math.max(1, Math.ceil(knownS)) : undefined), startS: o.startSeconds, audio: o.audio }); }
      catch { throw new AppError(502, "VIDEO_TRANSFORM_FAILED", "The video could not be transformed"); }
      const real = sniffMime(out.bytes);
      if (real !== "video/mp4") throw new AppError(502, "VIDEO_TRANSFORM_FAILED", "The transformation returned an unexpected file type");
      if (out.bytes.length > MEDIA_TRANSFORM_MAX_INPUT_BYTES) throw new AppError(502, "VIDEO_TRANSFORM_FAILED", "The converted video is too large");
      const meta = await readMp4Meta(async (from, to) => out.bytes.slice(from, to + 1), out.bytes.length).catch(() => null);
      if (!meta || !meta.width || !meta.height) throw new AppError(502, "VIDEO_TRANSFORM_FAILED", "The converted video could not be read back");
      const id = randomUUID(), key = `${workspaceId}/${id}.mp4`;
      await st.put(key, out.bytes, "video/mp4");
      const row = await repo.create(db, { id, workspaceId, kind: "video", key, filename: src.filename.replace(/\.[^.]+$/, "") + ".mp4", mime: "video/mp4", size: out.bytes.length, userId: a.id, derivedFrom: mediaId, derivation: { ...o }, status: "ready", width: meta.width, height: meta.height, durationMs: meta.durationMs ?? null });
      await auditRepository.record(db, { workspaceId, actorId: a.id, action: "media.derived", entityType: "media", entityId: id, metadata: { from: mediaId, kind: "video", cut }, ...(a.requestId ? { requestId: a.requestId } : {}) });
      return publicView(row);
    },

    async remove(a: Actor, workspaceId: string, mediaId: string) {
      await workspaces.authorize(a.id, workspaceId, "media:write");
      await db.tx(async (q) => {
        const m = await repo.get(q, workspaceId, mediaId, true);
        if (!m) throw notFound("Media");
        const used = await repo.usageCount(q, workspaceId, mediaId);
        if (used > 0) throw new AppError(409, "MEDIA_IN_USE", `Media is attached to ${used} post(s); detach it first`);
        await repo.remove(q, workspaceId, mediaId);
        await auditRepository.record(q, { workspaceId, actorId: a.id, action: "media.deleted", entityType: "media", entityId: mediaId, ...(a.requestId ? { requestId: a.requestId } : {}) });
        if (deps.storage) await deps.storage.delete(m.storage_key).catch(() => {});   // best effort; orphan objects are harmless (unreachable)
      });
    },
  };
}
export type MediaService = ReturnType<typeof createMediaService>;

/** Maintenance (cron): drop uploads that were never confirmed, and rejected files. */
export async function cleanupAbandonedUploads(db: Db, storage: ObjectStorage | null, olderThanHours = 24): Promise<number> {
  const rows = (await repo.staleUploads(db, olderThanHours, 100)).rows;
  for (const r of rows) {
    await storage?.delete(r.storage_key).catch(() => {});
    await repo.remove(db, r.workspace_id, r.id);
  }
  return rows.length;
}
