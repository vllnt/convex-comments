import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { query } from "./_generated/server";
import { commentView } from "./validators";
import { VISIBLE_STATUSES } from "../shared";
import type { Doc } from "./_generated/dataModel";

/** Project a stored comment row to its public view (exposes the id as a string). */
function view(comment: Doc<"comments">) {
  return {
    commentId: comment._id,
    resourceRef: comment.resourceRef,
    authorRef: comment.authorRef,
    parentId: comment.parentId,
    body: comment.body,
    status: comment.status,
    editedAt: comment.editedAt,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
  };
}

/** The current view of one comment, or `null` if no such id is held. */
export const get = query({
  args: { commentId: v.id("comments") },
  returns: v.union(v.null(), commentView),
  handler: async (ctx, args) => {
    const comment = await ctx.db.get(args.commentId);
    return comment === null ? null : view(comment);
  },
});

/**
 * Page comments on one `resourceRef`, oldest first. By default only top-level
 * comments are returned (`parentId === undefined`); pass `parentId` to page one
 * comment's direct replies via the `by_resource_parent` index. Soft-deleted
 * comments are excluded unless `includeDeleted` is set. Returns the standard
 * Convex paginated envelope (`page`, `isDone`, `continueCursor`) so the host can
 * render a thread reactively.
 */
export const list = query({
  args: {
    resourceRef: v.string(),
    parentId: v.optional(v.id("comments")),
    includeDeleted: v.optional(v.boolean()),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(commentView),
    isDone: v.boolean(),
    continueCursor: v.string(),
    splitCursor: v.optional(v.union(v.string(), v.null())),
    pageStatus: v.optional(
      v.union(
        v.literal("SplitRecommended"),
        v.literal("SplitRequired"),
        v.null(),
      ),
    ),
  }),
  handler: async (ctx, args) => {
    // `by_resource_parent` keys on (resourceRef, parentId): an omitted `parentId`
    // pages the resource's top level (root comments, `parentId === undefined`); a
    // given `parentId` pages that comment's direct replies.
    const base = ctx.db
      .query("comments")
      .withIndex("by_resource_parent", (q) =>
        q.eq("resourceRef", args.resourceRef).eq("parentId", args.parentId),
      );

    const filtered = args.includeDeleted
      ? base
      : base.filter((q) => q.neq(q.field("status"), "deleted"));

    const result = await filtered.order("asc").paginate(args.paginationOpts);
    return { ...result, page: result.page.map(view) };
  },
});

/**
 * Count the visible (non-deleted) comments on one `resourceRef`. Reads the whole
 * resource slice via the `by_resource` index and tallies the open/resolved rows —
 * a small per-resource scan, not a global one. Soft-deleted comments are never
 * counted.
 */
export const count = query({
  args: { resourceRef: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("comments")
      .withIndex("by_resource", (q) => q.eq("resourceRef", args.resourceRef))
      .collect();
    return all.filter((c) => VISIBLE_STATUSES.has(c.status)).length;
  },
});
