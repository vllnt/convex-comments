# API Reference — @vllnt/convex-comments

**Compatibility:** `convex@^1.45.0` (development and tests run on 1.51.0; the
1.45.0 floor is not tested in CI)

## Entry points

| Import                                                   | Exports                                                                                                                  |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `@vllnt/convex-comments`                                 | `Comments` class; types `CommentsComponent`, `CommentsOptions`, `CommentStatus`, `CommentView`, `ListOptions`, `Parser` |
| `@vllnt/convex-comments/convex.config` (or `.js`)        | default component config for `app.use(...)`                                                                              |
| `@vllnt/convex-comments/test`                            | `register(t, name = "comments")` for `convex-test` (TypeScript source; needs Vite `import.meta.glob`)                    |
| `@vllnt/convex-comments/_generated/component` (or `.js`) | type `ComponentApi`                                                                                                      |

The TypeScript source ships in `src/`; the compiled client and `.d.ts` files
ship in `dist/`.

**Time is server-sourced.** Every handler stamps
`createdAt`/`updatedAt`/`editedAt` from `Date.now()` itself; no method accepts a
caller-supplied clock.

**Authorship.** `edit`, `remove`, and `resolve` require the original
`authorRef`; a non-author caller is rejected (`NOT_AUTHOR`). The component
enforces only this authorship invariant — the host owns who may post or
moderate. Comments stored by 0.1.0 with an empty `authorRef` still exist, and
since only `post` checks refs (`INVALID_REF`), `edit`, `remove`, and `resolve`
accept a caller passing `""` as their author: hosts should reject an empty
`authorRef` before calling those.

**Validation.** When `bodyValidator` is set it runs at the client boundary: over
the value written by `post` / `edit` (before storage) and over the value
returned by `get` / `list` (on read). It must return the typed value or throw.
Omit it to leave the opaque body unvalidated.

## Client

### `Comments`

```ts
new Comments<TBody = unknown>(component: CommentsComponent, options?: CommentsOptions<TBody>)
```

`component` is the mounted component, `components.comments` (or the name passed
to `app.use`). `TBody` is the host's opaque comment body type. Mutations run
through `ctx.runMutation` and queries through `ctx.runQuery`, so call them from
host mutations and queries (queries also work from a mutation `ctx`). The
README [Quick start](../README.md#quick-start) constructs one with a
`bodyValidator`; that example is type-checked by `pnpm check:docs`.

### `post`

```ts
post(ctx, resourceRef: string, authorRef: string, body: TBody, parentId?: string): Promise<{ commentId: string }>
```

Post a comment on `resourceRef` authored by `authorRef` and return its id. The
comment is inserted `open` with `createdAt`/`updatedAt` stamped from the server
clock. `resourceRef` and `authorRef` are opaque host refs; `body` is opaque host
data validated against `bodyValidator` before storage. `parentId`, when given,
threads the comment as a reply.

An empty `resourceRef` or `authorRef` throws
`ConvexError({ code: "INVALID_REF" })`. A `parentId` that names no comment
throws `PARENT_NOT_FOUND`; a parent on a different resource throws
`PARENT_MISMATCH`; a soft-deleted parent throws `PARENT_DELETED`.

### `edit`

```ts
edit(ctx, commentId: string, authorRef: string, body: TBody): Promise<null>
```

Replace a comment's body, recording `editedAt`/`updatedAt` from the server
clock. The status does not change. The new `body` is validated against
`bodyValidator` before storage. Only the original author may edit
(`NOT_AUTHOR`); a soft-deleted comment cannot be edited (`DELETED`); a missing
id throws `NOT_FOUND`.

### `remove`

```ts
remove(ctx, commentId: string, authorRef: string): Promise<null>
```

Soft-delete a comment: the row is kept (its replies are preserved) but moved to
`deleted` status with its body cleared, so the prune cron can sweep it after the
retention window. Idempotent — its author re-deleting a `deleted` comment is a
no-op. Only the original author may delete (`NOT_AUTHOR`, checked first); a
missing id throws `NOT_FOUND`.

### `resolve`

```ts
resolve(ctx, commentId: string, authorRef: string, resolved = true): Promise<null>
```

Toggle a comment's resolved state. `resolved` defaults to `true`
(`open → resolved`); pass `false` to reopen. Idempotent — setting the state it
already holds is a no-op and `updatedAt` does not change. Only the original
author may resolve (`NOT_AUTHOR`); a soft-deleted comment cannot be resolved
(`DELETED`); a missing id throws `NOT_FOUND`.

### `get`

```ts
get(ctx, commentId: string): Promise<CommentView<TBody> | null>
```

The current view of `commentId`, or `null` if no such comment is held (never
existed or was pruned). `body` is narrowed by the host validator when set, and
is `undefined` once the comment is soft-deleted.

### `list`

```ts
list(ctx, resourceRef: string, paginationOpts: PaginationOptions, opts?: ListOptions): Promise<PaginationResult<CommentView<TBody>>>
```

Page comments on one `resourceRef`, oldest first. By default pages the
resource's top level (`parentId === undefined`, excluding soft-deleted) via the
`by_resource_parent` index. Pass `opts.parentId` to page one comment's direct
replies, or `opts.includeDeleted` to include removed comments. Takes the
standard Convex `paginationOpts` and returns the standard paginated envelope
(`page`, `isDone`, `continueCursor`, plus the optional `splitCursor` and
`pageStatus` Convex may add) with each row narrowed by `bodyValidator`.

### `count`

```ts
count(ctx, resourceRef: string): Promise<number>
```

The number of visible (open or resolved) comments on `resourceRef`, replies
included. Soft-deleted comments are never counted. The query reads one
maintained counter document per resource, so it costs O(1) reads and re-runs
only when a comment is posted or removed. The counter is created by the first
`post` on a resource with no comments; a resource that already had comments
before the counter existed keeps scanning its comment slice.

### `prune`

```ts
prune(ctx, opts?: { before?: number; batch?: number }): Promise<number>
```

Defaults: `before = Date.now() - 30 days` (read on the server), `batch = 200`;
valid batch range: integers 1–500 (`INVALID_BATCH`); `before` must be finite
(`INVALID_BEFORE`).

Page through **soft-deleted** comments whose `updatedAt < before`, oldest first
(via the `by_status_updated` index), and delete only leaf tombstones. A
tombstone with replies remains so no reply acquires a dangling `parentId`. Open
and resolved comments are never pruned. Returns the number deleted by the first
pass. The sweep self-reschedules through the component scheduler until it has
paged every candidate; after each full sweep that deleted anything it starts a
fresh sweep, and it stops after a sweep that deletes nothing. It is idempotent
and a built-in daily cron drives it automatically; call `prune` directly only
for an extra or custom-cadence sweep.

## Types

### `CommentsComponent`

The type of `components.comments`: the component's `mutations` (`post`, `edit`,
`remove`, `resolve`, `prune`) and `queries` (`get`, `list`, `count`) function
references, with the stored `body` typed `unknown`.

### `CommentsOptions`

`{ bodyValidator?: Parser<TBody> }`. The constructor accepts no other option.

### `CommentView`

```ts
{ commentId: string; resourceRef: string; authorRef: string; parentId?: string; body?: TBody; status: CommentStatus; editedAt?: number; createdAt: number; updatedAt: number }
```

Timestamps are absolute milliseconds. `editedAt` is set by `edit` only;
`updatedAt` changes on every edit, status change and delete.

### `CommentStatus`

`"open" | "resolved" | "deleted"`. `post` creates `open`; `resolve` moves
between `open` and `resolved`; `remove` moves to `deleted` (terminal).

### `ListOptions`

`{ parentId?: string; includeDeleted?: boolean }`, both optional.

### `Parser`

`(value: unknown) => T`. Must return the typed value or throw. Convex `v.*`
validators have no `.parse` method; pass your own function or a schema
library's parse function.

## Other entry points

### `convex.config`

The default export of `@vllnt/convex-comments/convex.config` is the component
definition (`defineComponent("comments")`). Mount it with `app.use(comments)`,
or `app.use(comments, { name })` for another independent instance reached as
`components.<name>`.

### `register`

```ts
register<TSchema extends GenericSchema>(t: TestConvex<SchemaDefinition<TSchema, boolean>>, name = "comments"): void
```

Mounts the component in the `convex-test` instance `convexTest(schema, modules)`
returns, for any host schema. Pass the mount name when you used
`app.use(comments, { name })`. Needs `convex-test` and Vite's `import.meta.glob`
in the consuming app.

### `ComponentApi`

The generated type of the mounted component's function references, from
`@vllnt/convex-comments/_generated/component`.

## Error codes

Coded `ConvexError`s thrown by the component (`error.data.code`):

| Code               | Thrown by                   | Meaning                                            |
| ------------------ | --------------------------- | -------------------------------------------------- |
| `INVALID_BATCH`    | `prune`                     | Batch must be an integer from 1–500.               |
| `INVALID_BEFORE`   | `prune`                     | The cutoff must be finite.                         |
| `INVALID_REF`      | `post`                      | `resourceRef` or `authorRef` is an empty string.   |
| `PARENT_NOT_FOUND` | `post`                      | The `parentId` names no comment.                   |
| `PARENT_MISMATCH`  | `post`                      | The parent belongs to a different resource.        |
| `PARENT_DELETED`   | `post`                      | The parent comment is soft-deleted.                |
| `NOT_FOUND`        | `edit`, `remove`, `resolve` | No comment has this `commentId`.                   |
| `NOT_AUTHOR`       | `edit`, `remove`, `resolve` | The caller is not the comment's author.            |
| `DELETED`          | `edit`, `resolve`           | The comment is soft-deleted and cannot be mutated. |

A string that is not an id of the component's `comments` table, passed as
`commentId` or `parentId`, fails Convex argument validation (no `code`).

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

## Tables

Sandboxed in the component: `comments` (indexes `by_resource`,
`by_resource_parent`, `by_author`, `by_status_updated`) and `resourceCounts`
(index `by_resource`, one row per resource holding the visible count). The
component reads and writes no host table.
