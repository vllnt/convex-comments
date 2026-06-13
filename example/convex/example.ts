import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { Comments } from "../../src/client";

/**
 * Host-app wrappers. The host owns auth: resolve identity here, then pass opaque
 * `resourceRef` / `authorRef` and an opaque `body` into the client. Time is
 * server-sourced inside the component — there is no clock to pass.
 */
const comments = new Comments<string>(components.comments);

/** A second client on the named `annotations` mount — proves mount-safe isolation. */
const annotations = new Comments<string>(components.annotations);

/**
 * A strict client that validates the body against a host parser — proves the
 * `bodyValidator` boundary on write and read (here: a non-empty string body).
 */
const strict = new Comments<string>(components.comments, {
  bodyValidator: (value) => {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error("invalid body: expected a non-empty string");
    }
    return value;
  },
});

const commentView = v.object({
  commentId: v.string(),
  resourceRef: v.string(),
  authorRef: v.string(),
  parentId: v.optional(v.string()),
  body: v.optional(v.any()),
  status: v.union(
    v.literal("open"),
    v.literal("resolved"),
    v.literal("deleted"),
  ),
  editedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const paginated = v.object({
  page: v.array(commentView),
  isDone: v.boolean(),
  continueCursor: v.string(),
  splitCursor: v.optional(v.union(v.string(), v.null())),
  pageStatus: v.optional(
    v.union(v.literal("SplitRecommended"), v.literal("SplitRequired"), v.null()),
  ),
});

export const post = mutation({
  args: {
    resourceRef: v.string(),
    authorRef: v.string(),
    body: v.string(),
    parentId: v.optional(v.string()),
  },
  returns: v.object({ commentId: v.string() }),
  handler: (ctx, a) =>
    comments.post(ctx, a.resourceRef, a.authorRef, a.body, a.parentId),
});

export const edit = mutation({
  args: { commentId: v.string(), authorRef: v.string(), body: v.string() },
  returns: v.null(),
  handler: (ctx, a) => comments.edit(ctx, a.commentId, a.authorRef, a.body),
});

export const remove = mutation({
  args: { commentId: v.string(), authorRef: v.string() },
  returns: v.null(),
  handler: (ctx, a) => comments.remove(ctx, a.commentId, a.authorRef),
});

export const resolve = mutation({
  args: {
    commentId: v.string(),
    authorRef: v.string(),
    resolved: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: (ctx, a) =>
    comments.resolve(ctx, a.commentId, a.authorRef, a.resolved),
});

export const get = query({
  args: { commentId: v.string() },
  returns: v.union(v.null(), commentView),
  handler: (ctx, a) => comments.get(ctx, a.commentId),
});

export const list = query({
  args: {
    resourceRef: v.string(),
    parentId: v.optional(v.string()),
    includeDeleted: v.optional(v.boolean()),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginated,
  handler: (ctx, a) =>
    comments.list(ctx, a.resourceRef, a.paginationOpts, {
      parentId: a.parentId,
      includeDeleted: a.includeDeleted,
    }),
});

export const count = query({
  args: { resourceRef: v.string() },
  returns: v.number(),
  handler: (ctx, a) => comments.count(ctx, a.resourceRef),
});

export const prune = mutation({
  args: { before: v.optional(v.number()), batch: v.optional(v.number()) },
  returns: v.number(),
  handler: (ctx, a) => comments.prune(ctx, { before: a.before, batch: a.batch }),
});

/** Named-mount variants — prove a second instance is independent. */
export const postAnnotation = mutation({
  args: { resourceRef: v.string(), authorRef: v.string(), body: v.string() },
  returns: v.object({ commentId: v.string() }),
  handler: (ctx, a) =>
    annotations.post(ctx, a.resourceRef, a.authorRef, a.body),
});

export const countAnnotations = query({
  args: { resourceRef: v.string() },
  returns: v.number(),
  handler: (ctx, a) => annotations.count(ctx, a.resourceRef),
});

export const pruneAnnotations = mutation({
  args: {},
  returns: v.number(),
  handler: (ctx) => annotations.prune(ctx),
});

/** Strict-client variants — exercise the body validator. */
export const postStrict = mutation({
  args: { resourceRef: v.string(), authorRef: v.string(), body: v.any() },
  returns: v.object({ commentId: v.string() }),
  handler: (ctx, a) => strict.post(ctx, a.resourceRef, a.authorRef, a.body),
});

export const editStrict = mutation({
  args: { commentId: v.string(), authorRef: v.string(), body: v.any() },
  returns: v.null(),
  handler: (ctx, a) => strict.edit(ctx, a.commentId, a.authorRef, a.body),
});

export const getStrict = query({
  args: { commentId: v.string() },
  returns: v.union(v.null(), commentView),
  handler: (ctx, a) => strict.get(ctx, a.commentId),
});

/**
 * Host-side resource helper — writes the host's own `resources` table, completely
 * outside the component's sandbox, proving host/component table isolation.
 */
export const addResource = mutation({
  args: { resourceRef: v.string(), title: v.string() },
  returns: v.null(),
  handler: async (ctx, { resourceRef, title }) => {
    await ctx.db.insert("resources", { resourceRef, title });
    return null;
  },
});

export const getResourceTitle = query({
  args: { resourceRef: v.string() },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, { resourceRef }) => {
    const row = await ctx.db
      .query("resources")
      .withIndex("by_resource", (q) => q.eq("resourceRef", resourceRef))
      .unique();
    return row?.title ?? null;
  },
});
