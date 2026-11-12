import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db, Queryable } from "../../infrastructure/database/db.js";
import { AppError, forbidden, notFound } from "../../shared/errors/errors.js";
import { decodeCursor, page } from "../../shared/utils/pagination.js";
import { auditRepository } from "../audit/audit.repository.js";
import type { ContentService } from "../content/content.service.js";
import type { NotificationService } from "../notifications/notification.service.js";
import type { Actor, WorkspaceService } from "../workspaces/workspace.service.js";
import { approvalRepository as repo, type RequestRow } from "./approval.repository.js";

const cursorSchema = z.object({ createdAt: z.string(), id: z.string() });
const stable = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

/** Fingerprint of everything that would be published. Approving one version never approves an edited one. */
export function contentHash(post: { title: string | null; body: string; hashtags: string[] }, variants: { social_account_id: string; id: string; caption: string | null; title: string | null; description: string | null; hashtags: string[] | null; metadata: unknown }[], media: { variant_id: string | null; media_id: string; role: string; position: number }[]): string {
  const accountOf = new Map(variants.map((v) => [v.id, v.social_account_id]));
  return createHash("sha256").update(stable({
    post: { title: post.title, body: post.body, hashtags: post.hashtags },
    variants: variants.map((v) => ({ account: v.social_account_id, caption: v.caption, title: v.title, description: v.description, hashtags: v.hashtags, metadata: v.metadata })).sort((a, b) => (a.account < b.account ? -1 : 1)),
    media: media.map((m) => ({ variant: m.variant_id ? accountOf.get(m.variant_id) ?? null : null, media: m.media_id, role: m.role, position: m.position })).sort((a, b) => stable(a).localeCompare(stable(b))),
  })).digest("hex");
}

export function createApprovalService(deps: { db: Db; workspaces: WorkspaceService; content: ContentService; notifications: NotificationService }) {
  const { db, workspaces, content, notifications } = deps;
  const audit = (q: Queryable, a: Actor, ws: string, action: string, entityId: string, metadata?: Record<string, unknown>) =>
    auditRepository.record(q, { workspaceId: ws, actorId: a.id, action, entityType: "approval_request", entityId, ...(metadata ? { metadata } : {}), ...(a.requestId ? { requestId: a.requestId } : {}) });
  const currentHash = async (q: Queryable, ws: string, postId: string) => { const d = await content.validateForPublish(ws, postId, q); return { hash: contentHash(d.post, d.variants, d.media), ...d }; };
  const view = (r: RequestRow) => ({ id: r.id, postId: r.post_id, requestedBy: r.requested_by, status: r.status, requiredApprovals: r.required_approvals, note: r.note, createdAt: r.created_at, decidedAt: r.decided_at });

  return {
    async getPolicy(a: Actor, workspaceId: string) {
      await workspaces.authorize(a.id, workspaceId, "workspace:read");
      const p = await repo.policy(db, workspaceId);
      return { required: p.required, requiredApprovals: p.required_approvals };
    },
    async setPolicy(a: Actor, workspaceId: string, i: { required: boolean; requiredApprovals: number }) {
      await workspaces.authorize(a.id, workspaceId, "workspace:update");
      await repo.setPolicy(db, workspaceId, i.required, i.requiredApprovals, a.id);
      await auditRepository.record(db, { workspaceId, actorId: a.id, action: "approval_policy.updated", metadata: i, ...(a.requestId ? { requestId: a.requestId } : {}) });
      return i;
    },

    /** Writer submits a draft for review. Only valid content can be submitted. */
    async submit(a: Actor, workspaceId: string, postId: string, note?: string) {
      return db.tx(async (q) => {
        await workspaces.authorize(a.id, workspaceId, "content:write", q);
        const d = await currentHash(q, workspaceId, postId).catch((e) => { throw e instanceof AppError ? e : notFound("Post"); });
        if (d.post.status !== "draft") throw new AppError(409, "POST_NOT_EDITABLE", "Only drafts can be submitted for approval");
        const errors = d.report.variants.flatMap((v) => v.issues.filter((i) => i.severity === "error"));
        if (!d.variants.length || errors.length) throw new AppError(422, "POST_INVALID", "Fix the content errors before requesting approval", { issues: errors, noDestinations: !d.variants.length });
        const policy = await repo.policy(q, workspaceId);
        let r;
        try { r = await repo.create(q, { workspaceId, postId, userId: a.id, hash: d.hash, required: policy.required_approvals, note }); }
        catch (e) { if ((e as { code?: string }).code === "23505") throw new AppError(409, "APPROVAL_ALREADY_PENDING", "This post already has a pending approval request"); throw e; }
        await audit(q, a, workspaceId, "approval.requested", r.id, { postId });
        await notifications.notify(q, { workspaceId, userIds: await notifications.holders(q, workspaceId, "approvals:decide", a.id), type: "approval_requested", title: "Approval requested", body: `"${d.post.title || d.post.body.slice(0, 60) || "A post"}" needs your review.`, data: { requestId: r.id, postId }, ref: `approval:${r.id}:requested` });
        return view(r);
      });
    },

    /** Reviewer decision. One vote per reviewer, never on their own request, never on content that changed since submission. */
    async decide(a: Actor, workspaceId: string, requestId: string, decision: "approved" | "rejected", comment?: string) {
      const out = await db.tx(async (q) => {
        await workspaces.authorize(a.id, workspaceId, "approvals:decide", q);
        const r = await repo.get(q, workspaceId, requestId, true);
        if (!r) throw notFound("Approval request");
        if (r.status !== "pending") throw new AppError(409, "APPROVAL_CLOSED", `This request is already ${r.status}`);
        if (r.requested_by === a.id) throw new AppError(403, "SELF_APPROVAL", "You cannot decide on your own request");
        const { hash } = await currentHash(q, workspaceId, r.post_id);
        if (hash !== r.content_hash) { await repo.setStatus(q, workspaceId, requestId, "cancelled"); return "stale" as const; }   // committed, then reported below
        try { await repo.addDecision(q, workspaceId, requestId, a.id, decision, comment); }
        catch (e) { if ((e as { code?: string }).code === "23505") throw new AppError(409, "ALREADY_DECIDED", "You already decided on this request"); throw e; }
        let status: RequestRow["status"] = "pending";
        if (decision === "rejected") status = "rejected";
        else if ((await repo.approvedCount(q, workspaceId, requestId)) >= r.required_approvals) status = "approved";
        if (status !== "pending") await repo.setStatus(q, workspaceId, requestId, status);
        await audit(q, a, workspaceId, `approval.${decision}`, requestId, { postId: r.post_id, status });
        if (status !== "pending")
          await notifications.notify(q, { workspaceId, userIds: [r.requested_by], type: "approval_decided", title: status === "approved" ? "Your post was approved" : "Your post was rejected", body: comment ? `Reviewer comment: ${comment}` : status === "approved" ? "It can now be published or scheduled." : "Edit it and submit it again.", data: { requestId, postId: r.post_id, status }, ref: `approval:${requestId}:${status}` });
        return { ...view((await repo.get(q, workspaceId, requestId))!), decision };
      });
      if (out === "stale") throw new AppError(409, "STALE_REQUEST", "The post was edited after it was submitted; ask the author to submit it again");
      return out;
    },

    async cancel(a: Actor, workspaceId: string, requestId: string) {
      await db.tx(async (q) => {
        await workspaces.authorize(a.id, workspaceId, "content:write", q);
        const r = await repo.get(q, workspaceId, requestId, true);
        if (!r) throw notFound("Approval request");
        if (r.status !== "pending") throw new AppError(409, "APPROVAL_CLOSED", `This request is already ${r.status}`);
        if (r.requested_by !== a.id && !(await workspaces.authorize(a.id, workspaceId, "approvals:decide", q).then(() => true, () => false))) throw forbidden();
        await repo.setStatus(q, workspaceId, requestId, "cancelled");
        await audit(q, a, workspaceId, "approval.cancelled", requestId);
      });
    },

    async list(a: Actor, workspaceId: string, f: { limit: number; cursor?: string | undefined; status?: string | undefined; postId?: string | undefined }) {
      await workspaces.authorize(a.id, workspaceId, "content:read");
      const rows = (await repo.list(db, workspaceId, { ...f, after: decodeCursor(f.cursor, cursorSchema) })).rows;
      return page(rows, f.limit, (r) => ({ createdAt: r.created_at, id: r.id }));
    },
    async get(a: Actor, workspaceId: string, requestId: string) {
      await workspaces.authorize(a.id, workspaceId, "content:read");
      const r = await repo.get(db, workspaceId, requestId);
      if (!r) throw notFound("Approval request");
      const stale = r.status === "pending" ? (await currentHash(db, workspaceId, r.post_id)).hash !== r.content_hash : false;
      return { ...view(r), stale, decisions: (await repo.decisions(db, workspaceId, requestId)).rows.map((d) => ({ reviewerId: d.reviewer_id, decision: d.decision, comment: d.comment, at: d.created_at })) };
    },

    /**
     * Publishing gate (called inside the publish transaction). With approvals required, content must have an APPROVED request whose
     * fingerprint equals the post as it is now. Nothing is created and nothing is queued otherwise.
     */
    async assertPublishable(q: Queryable, workspaceId: string, postId: string) {
      const policy = await repo.policy(q, workspaceId);
      if (!policy.required) return;
      const approved = await repo.latestApproved(q, workspaceId, postId);
      if (!approved) throw new AppError(403, "APPROVAL_REQUIRED", "This workspace requires an approved review before publishing");
      if ((await currentHash(q, workspaceId, postId)).hash !== approved.content_hash) throw new AppError(403, "APPROVAL_OUTDATED", "The post changed after it was approved; submit it for approval again");
    },
  };
}
export type ApprovalService = ReturnType<typeof createApprovalService>;
