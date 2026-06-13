import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { commentStatus, jsonValue } from "./validators";

/**
 * Sandboxed table — the comment tree's own concern. A comment is attached to an
 * opaque host `resourceRef` (the thing being commented on) and authored by an
 * opaque `authorRef`; the host owns the meaning of both. `parentId` is the opaque
 * id of the comment this one replies to (absent at the top level), so the tree is
 * a self-referential thread. `body` is opaque host data (cleared on soft-delete);
 * `status` tracks the lifecycle. `editedAt` records the last edit, distinct from
 * `updatedAt` (any write).
 *
 * The three indexes serve: list/count one resource oldest-first (`by_resource`),
 * walk one parent's direct replies (`by_resource_parent`), list one author's
 * comments (`by_author`), and the retention sweep of soft-deleted rows
 * (`by_status_updated`).
 */
export default defineSchema({
  comments: defineTable({
    resourceRef: v.string(),
    authorRef: v.string(),
    parentId: v.optional(v.id("comments")),
    body: v.optional(jsonValue),
    status: commentStatus,
    editedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_resource", ["resourceRef", "createdAt"])
    .index("by_resource_parent", ["resourceRef", "parentId", "createdAt"])
    .index("by_author", ["authorRef", "createdAt"])
    .index("by_status_updated", ["status", "updatedAt"]),
});
