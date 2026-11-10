import { z } from "zod";
import type { Db, Queryable } from "../../infrastructure/database/db.js";
import type { AdapterRegistry } from "../../integrations/core/registry.js";
import type { ContentRules } from "../../integrations/core/rules.js";
import type { Platform } from "../../integrations/core/types.js";
import { AppError, badRequest, notFound } from "../../shared/errors/errors.js";
import { decodeCursor, page } from "../../shared/utils/pagination.js";
import { auditRepository } from "../audit/audit.repository.js";
import type { Actor, WorkspaceService } from "../workspaces/workspace.service.js";
import { contentRepository as repo } from "./content.repository.js";
import type { VariantInput } from "./content.schemas.js";
import { validatePost } from "./content.validator.js";

const cursorSchema = z.object({ createdAt: z.string(), id: z.string() });
const notEditable = () => new AppError(409, "POST_NOT_EDITABLE", "Only drafts can be changed");

export function createContentService(deps: { db: Db; workspaces: WorkspaceService; registry: AdapterRegistry; rules: Record<Platform, ContentRules> }) {
  const { db, workspaces, registry, rules } = deps;
  const audit = (q: Queryable, a: Actor, workspaceId: string, action: string, postId: string, metadata?: Record<string, unknown>) =>
    auditRepository.record(q, { workspaceId, actorId: a.id, action, entityType: "post", entityId: postId, ...(metadata ? { metadata } : {}), ...(a.requestId ? { requestId: a.requestId } : {}) });

  /** Every referenced id must belong to THIS workspace; foreign ids look identical to missing ones. */
  async function assertMedia(q: Queryable, workspaceId: string, ids: string[]) {
    const unique = [...new Set(ids)];
    if (unique.length && (await repo.mediaByIds(q, workspaceId, unique)).length !== unique.length) throw badRequest("One or more media items were not found in this workspace");
  }
  async function writeVariant(q: Queryable, workspaceId: string, postId: string, v: VariantInput, platformOf: Map<string, string>) {
    const variantId = await repo.upsertVariant(q, { workspaceId, postId, accountId: v.accountId, platform: platformOf.get(v.accountId)!, caption: v.caption, title: v.title, description: v.description, hashtags: v.hashtags, metadata: v.metadata });
    await repo.replaceMedia(q, workspaceId, postId, variantId, v.media ?? []);
  }
  async function resolveAccounts(q: Queryable, workspaceId: string, variants: VariantInput[]) {
    const ids = [...new Set(variants.map((v) => v.accountId))];
    if (ids.length !== variants.length) throw badRequest("Duplicate destination account in variants");
    const found = ids.length ? await repo.accountsByIds(q, workspaceId, ids) : [];
    if (found.length !== ids.length) throw badRequest("One or more accounts were not found in this workspace");
    if (found.some((a) => a.status === "disconnected")) throw badRequest("Cannot target a disconnected account");
    return new Map(found.map((a) => [a.id, a.platform]));
  }
  async function load(q: Queryable, workspaceId: string, postId: string) {
    const post = await repo.getPost(q, workspaceId, postId);
    if (!post) throw notFound("Post");
    const [variants, media] = await Promise.all([repo.variants(q, workspaceId, postId), repo.media(q, workspaceId, postId)]);
    return { post, variants: variants.rows, media: media.rows };
  }
  const present = (d: Awaited<ReturnType<typeof load>>) => ({
    ...d.post,
    media: d.media.filter((m) => m.variant_id === null).map((m) => ({ mediaId: m.media_id, role: m.role, kind: m.kind, filename: m.filename, status: m.status })),
    variants: d.variants.map((v) => ({
      id: v.id, accountId: v.social_account_id, platform: v.platform, accountName: v.account_name, caption: v.caption, title: v.title, description: v.description, hashtags: v.hashtags, metadata: v.metadata,
      media: d.media.filter((m) => m.variant_id === v.id).map((m) => ({ mediaId: m.media_id, role: m.role, kind: m.kind })),
    })),
  });
  return {
    async create(a: Actor, workspaceId: string, input: { title?: string | undefined; body: string; hashtags: string[]; labels: string[]; media: { mediaId: string; role: string }[]; variants: VariantInput[] }) {
      return db.tx(async (q) => {
        await workspaces.authorize(a.id, workspaceId, "content:write", q);
        await assertMedia(q, workspaceId, [...input.media.map((m) => m.mediaId), ...input.variants.flatMap((v) => v.media?.map((m) => m.mediaId) ?? [])]);
        const platformOf = await resolveAccounts(q, workspaceId, input.variants);
        const post = await repo.createPost(q, { workspaceId, userId: a.id, ...input });
        await repo.replaceMedia(q, workspaceId, post.id, null, input.media);
        for (const v of input.variants) await writeVariant(q, workspaceId, post.id, v, platformOf);
        await audit(q, a, workspaceId, "post.created", post.id);
        return present(await load(q, workspaceId, post.id));
      });
    },

    async list(a: Actor, workspaceId: string, f: { limit: number; cursor?: string | undefined; status?: string | undefined; label?: string | undefined; q?: string | undefined }) {
      await workspaces.authorize(a.id, workspaceId, "content:read");
      const rows = (await repo.list(db, workspaceId, { ...f, after: decodeCursor(f.cursor, cursorSchema) })).rows;
      return page(rows, f.limit, (r) => ({ createdAt: r.created_at, id: r.id }));
    },

    async get(a: Actor, workspaceId: string, postId: string) {
      await workspaces.authorize(a.id, workspaceId, "content:read");
      return present(await load(db, workspaceId, postId));
    },

    async update(a: Actor, workspaceId: string, postId: string, patch: { title?: string | null | undefined; body?: string | undefined; hashtags?: string[] | undefined; labels?: string[] | undefined; media?: { mediaId: string; role: string }[] | undefined }) {
      return db.tx(async (q) => {
        await workspaces.authorize(a.id, workspaceId, "content:write", q);
        const p = await repo.getPost(q, workspaceId, postId, true);
        if (!p) throw notFound("Post");
        if (p.status !== "draft") throw notEditable();
        if (patch.media) { await assertMedia(q, workspaceId, patch.media.map((m) => m.mediaId)); await repo.replaceMedia(q, workspaceId, postId, null, patch.media); }
        const { media: _m, ...fields } = patch;
        await repo.updatePost(q, workspaceId, postId, Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)));
        await audit(q, a, workspaceId, "post.updated", postId);
        return present(await load(q, workspaceId, postId));
      });
    },

    async remove(a: Actor, workspaceId: string, postId: string) {
      await db.tx(async (q) => {
        await workspaces.authorize(a.id, workspaceId, "content:write", q);
        const p = await repo.getPost(q, workspaceId, postId, true);
        if (!p) throw notFound("Post");
        if (p.status !== "draft") throw notEditable();
        await repo.deletePost(q, workspaceId, postId);
        await audit(q, a, workspaceId, "post.deleted", postId);
      });
    },

    async duplicate(a: Actor, workspaceId: string, postId: string, opts: { keepTitle?: boolean } = {}) {
      return db.tx(async (q) => {
        await workspaces.authorize(a.id, workspaceId, "content:write", q);
        const src = await load(q, workspaceId, postId);
        const copy = await repo.createPost(q, { workspaceId, userId: a.id, title: src.post.title ? (opts.keepTitle ? src.post.title : `${src.post.title} (copy)`) : undefined, body: src.post.body, hashtags: src.post.hashtags, labels: src.post.labels });
        await repo.replaceMedia(q, workspaceId, copy.id, null, src.media.filter((m) => m.variant_id === null).map((m) => ({ mediaId: m.media_id, role: m.role })));
        for (const v of src.variants) {
          const id = await repo.upsertVariant(q, { workspaceId, postId: copy.id, accountId: v.social_account_id, platform: v.platform, caption: v.caption, title: v.title, description: v.description, hashtags: v.hashtags, metadata: v.metadata });
          await repo.replaceMedia(q, workspaceId, copy.id, id, src.media.filter((m) => m.variant_id === v.id).map((m) => ({ mediaId: m.media_id, role: m.role })));
        }
        await audit(q, a, workspaceId, "post.duplicated", copy.id, { from: postId });
        return present(await load(q, workspaceId, copy.id));
      });
    },

    async putVariant(a: Actor, workspaceId: string, postId: string, v: VariantInput) {
      return db.tx(async (q) => {
        await workspaces.authorize(a.id, workspaceId, "content:write", q);
        const p = await repo.getPost(q, workspaceId, postId, true);
        if (!p) throw notFound("Post");
        if (p.status !== "draft") throw notEditable();
        await assertMedia(q, workspaceId, v.media?.map((m) => m.mediaId) ?? []);
        await writeVariant(q, workspaceId, postId, v, await resolveAccounts(q, workspaceId, [v]));
        await audit(q, a, workspaceId, "post.variant_saved", postId, { accountId: v.accountId });
        return present(await load(q, workspaceId, postId));
      });
    },

    async removeVariant(a: Actor, workspaceId: string, postId: string, accountId: string) {
      await db.tx(async (q) => {
        await workspaces.authorize(a.id, workspaceId, "content:write", q);
        const p = await repo.getPost(q, workspaceId, postId, true);
        if (!p) throw notFound("Post");
        if (p.status !== "draft") throw notEditable();
        if (!(await repo.deleteVariant(q, workspaceId, postId, accountId))) throw notFound("Variant");
        await audit(q, a, workspaceId, "post.variant_removed", postId, { accountId });
      });
    },

    async validate(a: Actor, workspaceId: string, postId: string) {
      await workspaces.authorize(a.id, workspaceId, "content:read");
      const d = await load(db, workspaceId, postId);
      return validatePost(d.post, d.variants, d.media, rules, registry);
    },
    /** For the publishing engine: authoritative server-side re-validation of the stored post. */
    async validateForPublish(workspaceId: string, postId: string, q: Queryable = db) {
      const d = await load(q, workspaceId, postId);
      return { ...d, report: validatePost(d.post, d.variants, d.media, rules, registry) };
    },
  };
}
export type ContentService = ReturnType<typeof createContentService>;
