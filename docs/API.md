# API Reference — @vllnt/convex-comments

**Compatibility:** `convex@^1.45.0`

Construct the client with the mounted component and an optional host body
validator:

```ts
import { Comments } from "@vllnt/convex-comments";

const comments = new Comments<string>(components.comments, {
  bodyValidator: (value) => {
    if (typeof value !== "string") throw new Error("Expected a string body");
    return value;
  },
});
```

`Comments<TBody = unknown>` is generic over the host's opaque comment `body`
type. All methods take the host `ctx` (a query or mutation context) as the first
argument.

**Time is server-sourced.** Every handler stamps
`createdAt`/`updatedAt`/`editedAt` from `Date.now()` itself; no method accepts a
caller-supplied clock.

**Authorship.** `edit`, `remove`, and `resolve` require the original
`authorRef`; a non-author caller is rejected (`NOT_AUTHOR`). The component
enforces only this authorship invariant — the host owns who may post or
moderate.

**Validation.** When `bodyValidator` is set it runs at the client boundary: over
the value written by `post` / `edit` (before storage) and over the value
returned by `get` / `list` (on read). It must return the typed value or throw.
Omit it to leave the opaque body unvalidated.

## Mutations

### `post(ctx, resourceRef, authorRef, body, parentId?) → { commentId }`

Post a comment on `resourceRef` authored by `authorRef` and return its id. The
comment is inserted `open` with `createdAt`/`updatedAt` stamped from the server
clock. `resourceRef` and `authorRef` are opaque host refs; `body` is opaque host
data validated against `bodyValidator` before storage. `parentId`, when given,
threads the comment as a reply.

A `parentId` that names no comment throws
`ConvexError({ code: "PARENT_NOT_FOUND" })`; a parent on a different resource
throws `PARENT_MISMATCH`; a soft-deleted parent throws `PARENT_DELETED`.

### `edit(ctx, commentId, authorRef, body) → null`

Replace a comment's body, recording `editedAt`/`updatedAt` from the server
clock. The new `body` is validated against `bodyValidator` before storage. Only
the original author may edit (`NOT_AUTHOR`); a soft-deleted comment cannot be
edited (`DELETED`); a missing id throws `NOT_FOUND`.

### `remove(ctx, commentId, authorRef) → null`

Soft-delete a comment: the row is kept (its replies are preserved) but moved to
`deleted` status with its body cleared, so the prune cron can sweep it after the
retention window. Idempotent — re-deleting a `deleted` comment is a no-op. Only
the original author may delete (`NOT_AUTHOR`); a missing id throws `NOT_FOUND`.

### `resolve(ctx, commentId, authorRef, resolved?) → null`

Toggle a comment's resolved state. `resolved` defaults to `true`
(`open → resolved`); pass `false` to reopen. Idempotent — setting the state it
already holds is a no-op. Only the original author may resolve (`NOT_AUTHOR`); a
soft-deleted comment cannot be resolved (`DELETED`); a missing id throws
`NOT_FOUND`.

### `prune(ctx, opts?) → number`

`opts`: `{ before?: number; batch?: number }` (defaults:
`before = Date.now() - 30 days`, `batch = 200`; valid batch range: 1–500).

Page through **soft-deleted** comments whose `updatedAt < before`, oldest first
(via the `by_status_updated` index), and delete only leaf tombstones. A
tombstone with replies remains so no reply acquires a dangling `parentId`. Open
and resolved comments are never pruned. The sweep self-reschedules through the
component scheduler, then starts one fresh pass when deletions may have made
ancestors into leaves. It is idempotent and a built-in daily cron drives it
automatically; call `prune` directly only for an extra or custom-cadence sweep.

## Queries

### `get(ctx, commentId) → CommentView | null`

The current view of `commentId`, or `null` if no such comment is held.
`CommentView` is
`{ commentId, resourceRef, authorRef, parentId?, body?, status, editedAt?, createdAt, updatedAt }`;
`body` is narrowed by the host validator when set, and is `undefined` once the
comment is soft-deleted.

### `list(ctx, resourceRef, paginationOpts, opts?) → PaginationResult<CommentView>`

`opts`: `{ parentId?: string; includeDeleted?: boolean }`.

Page comments on one `resourceRef`, oldest first. By default pages the
resource's top level (`parentId === undefined`, excluding soft-deleted) via the
`by_resource_parent` index. Pass `opts.parentId` to page one comment's direct
replies via the `by_resource_parent` index, or `opts.includeDeleted` to surface
removed comments. Takes the standard Convex `paginationOpts` and returns the
standard paginated envelope (`page`, `isDone`, `continueCursor`) with each row
narrowed.

### `count(ctx, resourceRef) → number`

The number of visible (open or resolved) comments on `resourceRef`. Soft-deleted
comments are never counted. The query collects the resource's entire comment
slice, including replies, before tallying; Convex read limits apply.

## Error codes

Coded `ConvexError`s thrown by the component (`error.data.code`):

| Code               | Thrown by                   | Meaning                                            |
| ------------------ | --------------------------- | -------------------------------------------------- |
| `INVALID_BATCH`    | `prune`                     | Batch must be a finite integer from 1–500.         |
| `INVALID_BEFORE`   | `prune`                     | The cutoff must be finite.                         |
| `PARENT_NOT_FOUND` | `post`                      | The `parentId` names no comment.                   |
| `PARENT_MISMATCH`  | `post`                      | The parent belongs to a different resource.        |
| `PARENT_DELETED`   | `post`                      | The parent comment is soft-deleted.                |
| `NOT_FOUND`        | `edit`, `remove`, `resolve` | No comment has this `commentId`.                   |
| `NOT_AUTHOR`       | `edit`, `remove`, `resolve` | The caller is not the comment's author.            |
| `DELETED`          | `edit`, `resolve`           | The comment is soft-deleted and cannot be mutated. |

## Cron / Maintenance

The component registers one cron (`crons.ts`):

| Job              | Cadence                      | Action                                                                                                |
| ---------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| `comments:prune` | every 24h (`PRUNE_INTERVAL`) | runs `prune` with `batch = PRUNE_BATCH` (200), self-rescheduling until the soft-deleted tail is clean |

Cadence is a static module constant (Convex cron definitions are static per
deployment). A host wanting a different cadence drives `prune` from its own
scheduler with an explicit `before` cutoff. This does not disable or reconfigure
the built-in 30-day sweep; a longer custom window does not extend its retention.
The cron is per-mount, so each `app.use(component, { name })` instance prunes
its own sandbox independently.
