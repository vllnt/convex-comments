/** Shared constants used by both `client/` and `component/`. */

export const COMPONENT_NAME = "comments";

/**
 * The lifecycle statuses a comment moves through. `open` is the freshly-posted
 * state; `resolve` toggles it to `resolved` and back; a soft `delete` moves it to
 * the terminal `deleted` state (the row is kept for retention, its `body` cleared).
 */
export const COMMENT_STATUSES = ["open", "resolved", "deleted"] as const;

/** A single comment lifecycle status. */
export type CommentStatus = (typeof COMMENT_STATUSES)[number];

/**
 * The non-deleted statuses a `list` returns by default — a soft-deleted comment
 * is excluded from a normal listing (the host opts in with `includeDeleted`).
 */
export const VISIBLE_STATUSES: ReadonlySet<CommentStatus> = new Set([
  "open",
  "resolved",
]);

/**
 * Default retention (ms) for soft-deleted comments before the prune cron sweeps
 * them: 30 days. Bounds unbounded growth of the `comments` table while leaving a
 * window in which a deletion can still be audited. A host that wants a different
 * window drives `prune` from its own scheduler with an explicit `before` cutoff.
 */
export const DEFAULT_RETENTION_MS = 2_592_000_000;

/** Default page size for a `prune` pass before the sweep self-reschedules. */
export const DEFAULT_PRUNE_BATCH = 200;
