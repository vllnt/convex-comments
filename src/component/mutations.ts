import { ConvexError, v } from "convex/values";
import { api } from "./_generated/api";
import { mutation } from "./_generated/server";
import { jsonValue } from "./validators";

/**
 * Post a comment on a resource and return its id. The comment is inserted `open`
 * with `createdAt`/`updatedAt` stamped from the server clock (`Date.now()` inside
 * the handler — never caller-supplied). `resourceRef` (the thing commented on) and
 * `authorRef` (who wrote it) are opaque host refs the component never inspects;
 * `body` is opaque host data narrowed by the host's `bodyValidator` at the client
 * boundary. `parentId`, when given, threads this comment as a reply to an existing
 * comment.
 *
 * @throws `ConvexError({ code: "PARENT_NOT_FOUND" })` when `parentId` names no
 *   comment.
 * @throws `ConvexError({ code: "PARENT_MISMATCH" })` when the parent belongs to a
 *   different resource — a reply must live on the same resource as its parent.
 * @throws `ConvexError({ code: "PARENT_DELETED" })` when the parent is soft-deleted
 *   — you cannot reply under a removed comment.
 */
export const post = mutation({
  args: {
    resourceRef: v.string(),
    authorRef: v.string(),
    body: jsonValue,
    parentId: v.optional(v.id("comments")),
  },
  returns: v.object({ commentId: v.id("comments") }),
  handler: async (ctx, args) => {
    if (args.parentId !== undefined) {
      const parent = await ctx.db.get(args.parentId);
      if (parent === null) {
        throw new ConvexError({
          code: "PARENT_NOT_FOUND",
          message: `parent comment "${args.parentId}" not found`,
        });
      }
      if (parent.resourceRef !== args.resourceRef) {
        throw new ConvexError({
          code: "PARENT_MISMATCH",
          message: `parent comment belongs to a different resource`,
        });
      }
      if (parent.status === "deleted") {
        throw new ConvexError({
          code: "PARENT_DELETED",
          message: `cannot reply under a deleted comment`,
        });
      }
    }

    const now = Date.now();
    const commentId = await ctx.db.insert("comments", {
      resourceRef: args.resourceRef,
      authorRef: args.authorRef,
      parentId: args.parentId,
      body: args.body,
      status: "open",
      createdAt: now,
      updatedAt: now,
    });
    return { commentId };
  },
});

/**
 * Edit a comment's body. Only the original author may edit — a non-author caller
 * is rejected (`NOT_AUTHOR`). A soft-deleted comment cannot be edited
 * (`DELETED`). Records `editedAt` (and `updatedAt`) from the server clock; the
 * new `body` is opaque host data narrowed at the client boundary.
 *
 * @throws `ConvexError({ code: "NOT_FOUND" })` when no comment has `commentId`.
 * @throws `ConvexError({ code: "NOT_AUTHOR" })` when `authorRef` is not the author.
 * @throws `ConvexError({ code: "DELETED" })` when the comment is soft-deleted.
 */
export const edit = mutation({
  args: {
    commentId: v.id("comments"),
    authorRef: v.string(),
    body: jsonValue,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const comment = await ctx.db.get(args.commentId);
    if (comment === null) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: `comment "${args.commentId}" not found`,
      });
    }
    if (comment.authorRef !== args.authorRef) {
      throw new ConvexError({
        code: "NOT_AUTHOR",
        message: `only the author may edit this comment`,
      });
    }
    if (comment.status === "deleted") {
      throw new ConvexError({
        code: "DELETED",
        message: `comment "${args.commentId}" is deleted and cannot be edited`,
      });
    }

    const now = Date.now();
    await ctx.db.patch(comment._id, {
      body: args.body,
      editedAt: now,
      updatedAt: now,
    });
    return null;
  },
});

/**
 * Soft-delete a comment. Only the original author may delete it (`NOT_AUTHOR`).
 * The row is kept (its replies are preserved) but moved to `deleted` status with
 * its `body` cleared, so the prune cron can sweep it after the retention window.
 * Idempotent — re-deleting an already-deleted comment is a no-op.
 *
 * @throws `ConvexError({ code: "NOT_FOUND" })` when no comment has `commentId`.
 * @throws `ConvexError({ code: "NOT_AUTHOR" })` when `authorRef` is not the author.
 */
export const remove = mutation({
  args: { commentId: v.id("comments"), authorRef: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const comment = await ctx.db.get(args.commentId);
    if (comment === null) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: `comment "${args.commentId}" not found`,
      });
    }
    if (comment.authorRef !== args.authorRef) {
      throw new ConvexError({
        code: "NOT_AUTHOR",
        message: `only the author may delete this comment`,
      });
    }
    if (comment.status === "deleted") {
      return null;
    }
    await ctx.db.patch(comment._id, {
      status: "deleted",
      body: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Toggle a comment's resolved state. Only the original author may resolve/reopen
 * (`NOT_AUTHOR`); a soft-deleted comment cannot be resolved (`DELETED`). Setting
 * `resolved: true` moves an `open` comment to `resolved`; `false` reopens it. The
 * target is idempotent — setting the state it already holds is a no-op.
 *
 * @throws `ConvexError({ code: "NOT_FOUND" })` when no comment has `commentId`.
 * @throws `ConvexError({ code: "NOT_AUTHOR" })` when `authorRef` is not the author.
 * @throws `ConvexError({ code: "DELETED" })` when the comment is soft-deleted.
 */
export const resolve = mutation({
  args: {
    commentId: v.id("comments"),
    authorRef: v.string(),
    resolved: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const comment = await ctx.db.get(args.commentId);
    if (comment === null) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: `comment "${args.commentId}" not found`,
      });
    }
    if (comment.authorRef !== args.authorRef) {
      throw new ConvexError({
        code: "NOT_AUTHOR",
        message: `only the author may resolve this comment`,
      });
    }
    if (comment.status === "deleted") {
      throw new ConvexError({
        code: "DELETED",
        message: `comment "${args.commentId}" is deleted and cannot be resolved`,
      });
    }
    const target = args.resolved ? "resolved" : "open";
    if (comment.status === target) {
      return null;
    }
    await ctx.db.patch(comment._id, { status: target, updatedAt: Date.now() });
    return null;
  },
});

/**
 * Delete up to `batch` soft-deleted comments whose `updatedAt < before`, oldest
 * first, via the `by_status_updated` index. `before` defaults to the server clock
 * (`Date.now()`) when omitted, so the built-in cron sweeps exactly the comments
 * deleted-and-stale as of the run. If a full batch was removed there may be more,
 * so the sweep self-reschedules through `ctx.scheduler` until a short batch
 * signals the tail is clean. Idempotent: only ever removes already-`deleted`,
 * past-retention rows. Open and resolved comments are never pruned.
 */
export const prune = mutation({
  args: { before: v.optional(v.number()), batch: v.number() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const before = args.before ?? Date.now();

    const stale = await ctx.db
      .query("comments")
      .withIndex("by_status_updated", (q) =>
        q.eq("status", "deleted").lt("updatedAt", before),
      )
      .take(args.batch);

    for (const row of stale) {
      await ctx.db.delete(row._id);
    }
    const removed = stale.length;

    if (removed === args.batch) {
      await ctx.scheduler.runAfter(0, api.mutations.prune, {
        before,
        batch: args.batch,
      });
    }
    return removed;
  },
});
