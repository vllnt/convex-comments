<!-- Badges -->
[![convex-component](https://img.shields.io/badge/convex-component-EE342F.svg)](https://www.convex.dev/components)
[![npm](https://img.shields.io/npm/v/@vllnt/convex-comments.svg)](https://www.npmjs.com/package/@vllnt/convex-comments)
[![CI](https://github.com/vllnt/convex-comments/actions/workflows/ci.yml/badge.svg)](https://github.com/vllnt/convex-comments/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@vllnt/convex-comments.svg)](./LICENSE)

# @vllnt/convex-comments

Threaded comments / annotations on any resource, as a Convex component.

```ts
const comments = new Comments(components.comments);
await comments.post(ctx, resourceRef, authorRef, body, parentId); // parentId threads a reply
await comments.list(ctx, resourceRef, paginationOpts);            // reactive thread
await comments.resolve(ctx, commentId, authorRef);               // author-gated
```

A host attaches a comment to an opaque `resourceRef` (an article, a doc, a clip — anything); replies
thread under a parent; the author edits, resolves, and soft-deletes their own comments; clients page a
resource's thread or subscribe reactively.

## Features

- **Post on any resource** — `post(resourceRef, authorRef, body, parentId?)` inserts an `open` comment; `parentId` threads it as a reply.
- **Author-gated edits** — `edit`, `remove` (soft-delete), and `resolve` require the original `authorRef`, else `NOT_AUTHOR`.
- **Threaded** — a reply links to a parent on the same resource (cross-resource or deleted parent rejected); `list(..., { parentId })` pages direct replies.
- **Soft-delete + retention** — `remove` keeps the row and replies but marks it `deleted` and clears the body; a daily cron prunes deleted rows past retention.
- **Page or subscribe** — `list` pages oldest-first (deleted excluded by default), `count` tallies visible ones. Reactive in a Convex query.
- **Server-sourced time** — `createdAt`/`updatedAt`/`editedAt` are stamped from the server clock; a caller can't supply a timestamp.
- **Typed, opaque body** — `Comments<TBody>` types the stored `body`; `bodyValidator` narrows plain text vs rich blocks at the boundary.
- **Mount-safe** — correct under multiple named `app.use` mounts (e.g. a `comments` mount + an `annotations` mount); each is an isolated sandbox.

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

export const postComment = mutation({
  args: { resourceRef: v.string(), body: v.string(), parentId: v.optional(v.string()) },
  handler: async (ctx, { resourceRef, body, parentId }) => {
    const authorRef = await requireUser(ctx); // host auth
    return comments.post(ctx, resourceRef, authorRef, body, parentId);
  },
});

export const listComments = query({
  args: { resourceRef: v.string(), paginationOpts: paginationOptsValidator },
  handler: (ctx, { resourceRef, paginationOpts }) =>
    comments.list(ctx, resourceRef, paginationOpts),
});
```

## API Reference

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

Full reference: [docs/API.md](docs/API.md).

## React

Backend-only — no `./react` entry. A comment thread is an ordinary reactive `useQuery` / `usePaginatedQuery` over the host's own re-exported `list` / `count` refs.

## Security

- Auth-agnostic for access; the component enforces only **authorship** (`edit`/`remove`/`resolve` require the original `authorRef`). The host owns who may post or moderate.
- Tables sandboxed — reached only through the exported functions; never touches host or sibling tables.
- Server-sourced time; `resourceRef` / `authorRef` / `body` stay opaque to the component.

See [docs/API.md](docs/API.md).

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
