/** Public TypeScript surface for the comments client. */

/** The three lifecycle statuses a comment moves through. */
export type CommentStatus = "open" | "resolved" | "deleted";

/**
 * Validates and narrows an opaque stored comment `body` to a host type `T` at the
 * client boundary. Receives the raw value the component returned (`unknown`) and
 * MUST return a typed `T` or throw. A `convex/values` validator's `.parse` (or a
 * Zod `.parse`) fits directly; omit it to keep the value unvalidated.
 *
 * @typeParam T - The host's stored comment body type.
 */
export type Parser<T> = (value: unknown) => T;

/** The public view returned by {@link Comments.get} / {@link Comments.list}. */
export interface CommentView<TBody = unknown> {
  /** The component-assigned opaque id naming this comment. */
  commentId: string;
  /** The host-supplied ref of the resource this comment is attached to. */
  resourceRef: string;
  /** The host-supplied ref of the comment's author. */
  authorRef: string;
  /** The opaque id of the comment this one replies to, when threaded. */
  parentId?: string;
  /** The opaque host body (narrowed if a `bodyValidator` is set); absent once deleted. */
  body?: TBody;
  /** The current lifecycle status. */
  status: CommentStatus;
  /** Absolute ms timestamp of the last body edit, if any. */
  editedAt?: number;
  /** Absolute ms timestamp the comment was posted. */
  createdAt: number;
  /** Absolute ms timestamp of the last write (edit, resolve, or delete). */
  updatedAt: number;
}

/** Per-call options for {@link Comments.list}. */
export interface ListOptions {
  /** Page one parent comment's direct replies instead of the resource's top level. */
  parentId?: string;
  /** Include soft-deleted comments in the page (excluded by default). */
  includeDeleted?: boolean;
}

/** Construction options for the {@link Comments} client. */
export interface CommentsOptions<TBody> {
  /**
   * Validates/narrows a stored comment `body` to `TBody` at the boundary — applied
   * to the `body` passed into `post` / `edit` (before storage) and the `body`
   * returned by `get` / `list`. Throws on a mismatch. Omit to leave bodies
   * unvalidated (plain text needs no validator; rich-block hosts pass their schema).
   */
  bodyValidator?: Parser<TBody>;
}
