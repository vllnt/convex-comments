import { v } from "convex/values";

/**
 * Opaque host-owned comment body — plain text, a rich-block JSON document, or
 * whatever shape the host's editor produces. The component never inspects it; it
 * is last-resort arbitrary data, aliased here rather than left bare in a function
 * signature. The host narrows it at the {@link Comments} client boundary via an
 * optional `bodyValidator` parser.
 *
 * This is the single documented `v.any()` escape hatch in the component; the lint
 * rule `convex-rules/no-bare-v-any` is satisfied by routing every arbitrary host
 * body through this alias instead of a bare `v.any()`.
 */
export const jsonValue = v.any();

/** The three lifecycle statuses a comment moves through. */
export const commentStatus = v.union(
  v.literal("open"),
  v.literal("resolved"),
  v.literal("deleted"),
);

/**
 * The visible (non-deleted) status subset a `list` filters on. A soft-deleted
 * comment is excluded from a normal listing.
 */
export const visibleStatus = v.union(v.literal("open"), v.literal("resolved"));

/**
 * Public projection of a comment returned by {@link get} / {@link list}. `body`
 * is opaque host data (`undefined` once soft-deleted — the body is cleared);
 * `parentId` is the opaque id of the comment this one replies to, when threaded.
 */
export const commentView = v.object({
  commentId: v.string(),
  resourceRef: v.string(),
  authorRef: v.string(),
  parentId: v.optional(v.string()),
  body: v.optional(jsonValue),
  status: commentStatus,
  editedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
});
