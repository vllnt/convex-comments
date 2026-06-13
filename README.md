<!-- Badges -->
[![convex-component](https://img.shields.io/badge/convex-component-EE342F.svg)](https://www.convex.dev/components)
[![npm](https://img.shields.io/npm/v/@vllnt/convex-comments.svg)](https://www.npmjs.com/package/@vllnt/convex-comments)
[![CI](https://github.com/vllnt/convex-comments/actions/workflows/ci.yml/badge.svg)](https://github.com/vllnt/convex-comments/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@vllnt/convex-comments.svg)](./LICENSE)

# @vllnt/convex-comments

Threaded comments / annotations on any resource, as a Convex component.

A host attaches a comment to an opaque `resourceRef` (an article, a doc, a social
post, a game clip — anything); replies thread under a parent; the author edits,
resolves, and soft-deletes their own comments; clients page a resource's thread —
or subscribe reactively. Domain-neutral: the host owns the resource, the author
identity, auth, and the body shape; this component owns only the comment tree.

## Features

- **Post on any resource** — `post(resourceRef, authorRef, body, parentId?)` inserts an `open` comment and hands back its id; `parentId` threads it as a reply to an existing comment.
- **Author-gated edits** — `edit`, `remove` (soft-delete), and `resolve` all require the original `authorRef`; a non-author caller is rejected with `ConvexError({ code: "NOT_AUTHOR" })`. The host still owns the higher-level auth decision.
- **Threaded** — a reply links to a parent in the same resource (a cross-resource or deleted parent is rejected); `list(resourceRef, opts, { parentId })` pages one comment's direct replies.
- **Soft-delete + retention** — `remove` keeps the row (preserving replies) but marks it `deleted` and clears its body; a built-in daily prune cron sweeps deleted comments past a retention window in bounded, self-rescheduling batches.
- **Page or subscribe** — `list(resourceRef, paginationOpts)` pages a resource's comments oldest-first via the standard Convex pagination envelope (excluding deleted by default); `count(resourceRef)` tallies the visible ones. In a reactive Convex query these update live.
- **Server-sourced time** — `createdAt`/`updatedAt`/`editedAt` are stamped from the server clock inside every handler; a caller can never supply a timestamp.
- **Typed, opaque body** — `Comments<TBody>` types the stored `body` end to end; pass `bodyValidator` to narrow plain text vs rich blocks at the boundary (no unchecked cast, no `v.any()` dump). The component stores the body opaquely.
- **Mount-safe** — runs correctly under multiple named `app.use` mounts; each instance is an isolated sandbox (e.g. a `comments` mount for discussion + an `annotations` mount for inline notes).

## Architecture

```
src/
├── shared.ts              # constants (component name, statuses, retention, batch)
├── test.ts                # convex-test register() helper
├── client/                # Comments class (the public API)
└── component/             # schema (comments) + mutations + queries + prune cron
```

Sandboxed table: `comments {resourceRef, authorRef, parentId?, body?, status,
editedAt?, createdAt, updatedAt}` — indexed for resource listing (`by_resource`),
reply listing (`by_resource_parent`), author listing (`by_author`), and the
retention sweep (`by_status_updated`). No host tables are touched. A built-in cron
(`crons.ts`) prunes soft-deleted comments daily.

## Installation

```bash
pnpm add @vllnt/convex-comments
```

Peer dependency: `convex@^1.41.0`.

## Usage

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import comments from "@vllnt/convex-comments/convex.config";

const app = defineApp();
app.use(comments);
export default app;
```

```ts
// convex/comments.ts — host owns auth; resolve identity, pass opaque refs in.
import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { Comments } from "@vllnt/convex-comments";

const comments = new Comments<string>(components.comments, {
  bodyValidator: v.string().parse, // narrow at the boundary (plain text here)
});

// Post a comment (the host decides who `authorRef` is).
export const postComment = mutation({
  args: { resourceRef: v.string(), body: v.string(), parentId: v.optional(v.string()) },
  handler: async (ctx, { resourceRef, body, parentId }) => {
    const authorRef = await requireUser(ctx); // host auth
    return comments.post(ctx, resourceRef, authorRef, body, parentId);
  },
});

// Page a resource's thread (reactively, in a Convex query).
export const listComments = query({
  args: { resourceRef: v.string(), paginationOpts: paginationOptsValidator },
  handler: (ctx, { resourceRef, paginationOpts }) =>
    comments.list(ctx, resourceRef, paginationOpts),
});
```

## API Reference

See [docs/API.md](docs/API.md). Summary:

| Method | Kind | Result |
|--------|------|--------|
| `post(ctx, resourceRef, authorRef, body, parentId?)` | mutation | `{ commentId }` |
| `edit(ctx, commentId, authorRef, body)` | mutation | `null` (author-gated) |
| `remove(ctx, commentId, authorRef)` | mutation | `null` (soft-delete, author-gated) |
| `resolve(ctx, commentId, authorRef, resolved?)` | mutation | `null` (toggle, author-gated; `resolved` defaults `true`) |
| `get(ctx, commentId)` | query | `CommentView \| null` |
| `list(ctx, resourceRef, paginationOpts, opts?)` | query | `PaginationResult<CommentView>` (`opts`: `{ parentId?; includeDeleted? }`) |
| `count(ctx, resourceRef)` | query | `number` (visible comments) |
| `prune(ctx, opts?)` | mutation | `number` (deleted comments removed in the first bounded pass) |

Client options:
`new Comments(component, { bodyValidator? })`.
`prune` opts: `{ before?; batch? }` (defaults `before = Date.now()`, `batch = 200`).

## React

This component ships **backend-only** — no `./react` entry. A comment thread is an
ordinary reactive `useQuery` / `usePaginatedQuery` over the host's own re-exported
`list` / `count` function refs (those return live in Convex), so a dedicated hook
would add a wrapper with no value over the host's existing `api`. If a future
consumer needs a shared management surface the analysis will be re-run (per the
Component Standard's front-end tooling decision).

## Security Model

The component is **auth-agnostic**: it never authenticates. It does enforce a
narrow **authorship** invariant — only the original `authorRef` may `edit`,
`remove`, or `resolve` a comment — but the host still owns the higher-level access
decision (who may post on a resource, who may moderate). The host resolves identity
and passes opaque `resourceRef` / `authorRef`. Component tables are sandboxed — the
host reaches them only through the exported functions, and the component never
reads host or sibling tables. `resourceRef`, `authorRef`, and the stored `body` are
opaque to the component; it never inspects or de-references them.

**Time is server-sourced** — `createdAt`, `updatedAt`, and `editedAt` come from
`Date.now()` inside each handler, never from the caller. The host may narrow the
opaque `body` with `bodyValidator`, applied at the client boundary on both write
and read.

## Testing

```bash
pnpm test           # single run
pnpm test:coverage  # enforced 100% on covered files
```

Tests run against the real component runtime via `convex-test` (`@edge-runtime/vm`), not mocks.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Author

Built by [bntvllnt](https://github.com/bntvllnt) · [bntvllnt.com](https://bntvllnt.com) · [X @bntvllnt](https://x.com/bntvllnt)

Part of the [@vllnt](https://github.com/vllnt) Convex component fleet — [vllnt.com](https://vllnt.com)

If this is useful, [sponsor the work](https://github.com/sponsors/bntvllnt).

## License

MIT — see [LICENSE](LICENSE).
