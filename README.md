# @vllnt/convex-comments

TypeScript Convex component for threaded comments and annotations on any
resource: replies, author-only edit and resolve, soft-delete, paging.

## For coding agents

Docs for the installed version are in `node_modules/@vllnt/convex-comments/`:
`docs/API.md`, `llms.txt`, `CHANGELOG.md` and the TypeScript `src/`. Read them
before writing code against this package.

## When to use

- Use it when people discuss a resource (a post, doc, ticket or clip) in text
  threads with replies.
- Use it when you need inline annotations or review notes that their author
  resolves and reopens.
- Use it when only the original author may edit, resolve or remove a comment.
- Do not use it when people only like, vote or react without text: use
  `@vllnt/convex-reactions`.
- Do not use it when the thread is a conversation with an AI agent: use
  `@convex-dev/agent`.

## Install

```bash
pnpm add @vllnt/convex-comments convex
```

These docs describe 0.2.0. Until `npm view @vllnt/convex-comments version`
shows 0.2.0, install `@vllnt/convex-comments@canary`.

## Quick start

```ts
// convex/convex.config.ts
import comments from "@vllnt/convex-comments/convex.config";
import { defineApp } from "convex/server";

const app = defineApp();
app.use(comments);
export default app;
```

```ts
// convex/comments.ts
import { Comments } from "@vllnt/convex-comments";
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { ConvexError, v } from "convex/values";

import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";

const comments = new Comments<string>(components.comments, {
  bodyValidator: (value) => {
    if (typeof value !== "string") throw new Error("expected a string body");
    return value;
  },
});

// The package exports no Convex validator for its rows; this one matches
// CommentView<string>.
export const commentView = v.object({
  commentId: v.string(),
  resourceRef: v.string(),
  authorRef: v.string(),
  parentId: v.optional(v.string()),
  body: v.optional(v.string()),
  status: v.union(
    v.literal("open"),
    v.literal("resolved"),
    v.literal("deleted"),
  ),
  editedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const post = mutation({
  args: {
    resourceRef: v.string(),
    body: v.string(),
    parentId: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, { resourceRef, body, parentId }) => {
    const user = await ctx.auth.getUserIdentity();
    if (user === null) throw new ConvexError("not signed in");
    const { commentId } = await comments.post(
      ctx,
      resourceRef,
      user.tokenIdentifier,
      body,
      parentId,
    );
    return commentId;
  },
});

export const thread = query({
  args: { resourceRef: v.string(), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(commentView),
  handler: (ctx, { resourceRef, paginationOpts }) =>
    comments.list(ctx, resourceRef, paginationOpts),
});
```

Run `npx convex dev` once to generate `components.comments`. The component
never reads auth: the host derives `authorRef` (here the user's
`tokenIdentifier`) and decides who may post on which resource. The command in
Install gets the `latest` release; `@vllnt/convex-comments@canary` is the newest
build from `main`.

## API

Full reference: [docs/API.md](docs/API.md). Every method takes the host `ctx`
first.

| Export                                                                           | Import from                                   | What it does                                                    |
| -------------------------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------- |
| [`Comments`](docs/API.md#comments)                                               | `@vllnt/convex-comments`                      | Host client: `new Comments<TBody>(components.comments, opts?)`  |
| [`post(ctx, resourceRef, authorRef, body, parentId?)`](docs/API.md#post)         | `Comments` method, mutation                   | Add an `open` comment or a reply; returns `{ commentId }`       |
| [`edit(ctx, commentId, authorRef, body)`](docs/API.md#edit)                      | `Comments` method, mutation                   | Replace the body (author only); returns `null`                  |
| [`remove(ctx, commentId, authorRef)`](docs/API.md#remove)                        | `Comments` method, mutation                   | Soft-delete and clear the body (author only); returns `null`    |
| [`resolve(ctx, commentId, authorRef, resolved?)`](docs/API.md#resolve)           | `Comments` method, mutation                   | Set `resolved` (default) or reopen (author only); returns `null` |
| [`get(ctx, commentId)`](docs/API.md#get)                                         | `Comments` method, query                      | One `CommentView` or `null`                                     |
| [`list(ctx, resourceRef, paginationOpts, opts?)`](docs/API.md#list)              | `Comments` method, query                      | One page of top-level comments or of one comment's replies      |
| [`count(ctx, resourceRef)`](docs/API.md#count)                                   | `Comments` method, query                      | Number of open and resolved comments on the resource            |
| [`prune(ctx, opts?)`](docs/API.md#prune)                                         | `Comments` method, mutation                   | Delete old soft-deleted leaf comments; returns the first pass count |
| [`CommentsComponent`](docs/API.md#commentscomponent)                             | `@vllnt/convex-comments` (type)               | Type of `components.comments`                                   |
| [`CommentsOptions`](docs/API.md#commentsoptions)                                 | `@vllnt/convex-comments` (type)               | `{ bodyValidator? }`                                            |
| [`CommentView`](docs/API.md#commentview)                                         | `@vllnt/convex-comments` (type)               | Result row of `get` and `list`                                  |
| [`CommentStatus`](docs/API.md#commentstatus)                                     | `@vllnt/convex-comments` (type)               | `"open" \| "resolved" \| "deleted"`                             |
| [`ListOptions`](docs/API.md#listoptions)                                         | `@vllnt/convex-comments` (type)               | `{ parentId?, includeDeleted? }`                                |
| [`Parser`](docs/API.md#parser)                                                   | `@vllnt/convex-comments` (type)               | `(value: unknown) => T`, the `bodyValidator` shape              |
| [`default` (component config)](docs/API.md#convexconfig)                         | `@vllnt/convex-comments/convex.config`        | Pass to `app.use(...)`                                          |
| [`register`](docs/API.md#register)                                               | `@vllnt/convex-comments/test`                 | Mount the component in `convex-test`                            |
| [`ComponentApi`](docs/API.md#componentapi)                                       | `@vllnt/convex-comments/_generated/component` | Generated type of the mounted component                         |

## Common tasks

Page one comment's direct replies and show the resource's comment count
(`commentView` is the validator from the Quick start):

```ts
// convex/replies.ts
import { Comments } from "@vllnt/convex-comments";
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";

import { components } from "./_generated/api";
import { query } from "./_generated/server";
import { commentView } from "./comments";

const comments = new Comments<string>(components.comments);

export const replies = query({
  args: {
    resourceRef: v.string(),
    parentId: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(commentView),
  handler: (ctx, { resourceRef, parentId, paginationOpts }) =>
    comments.list(ctx, resourceRef, paginationOpts, { parentId }),
});

export const total = query({
  args: { resourceRef: v.string() },
  returns: v.number(),
  handler: (ctx, { resourceRef }) => comments.count(ctx, resourceRef),
});
```

Let the signed-in author edit, resolve or remove their comment, and turn a
`NOT_AUTHOR` error into `false`:

```ts
// convex/moderation.ts
import { Comments } from "@vllnt/convex-comments";
import { ConvexError, v } from "convex/values";

import { components } from "./_generated/api";
import { mutation, type MutationCtx } from "./_generated/server";

const comments = new Comments<string>(components.comments);

async function authorOf(ctx: MutationCtx): Promise<string> {
  const user = await ctx.auth.getUserIdentity();
  if (user === null) throw new ConvexError("not signed in");
  return user.tokenIdentifier;
}

const isNotAuthor = (error: unknown): boolean =>
  error instanceof ConvexError &&
  typeof error.data === "object" &&
  error.data !== null &&
  "code" in error.data &&
  error.data.code === "NOT_AUTHOR";

export const editComment = mutation({
  args: { commentId: v.string(), body: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { commentId, body }) => {
    try {
      await comments.edit(ctx, commentId, await authorOf(ctx), body);
      return true;
    } catch (error) {
      if (isNotAuthor(error)) return false;
      throw error;
    }
  },
});

export const resolveComment = mutation({
  args: { commentId: v.string(), resolved: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { commentId, resolved }) =>
    comments.resolve(ctx, commentId, await authorOf(ctx), resolved),
});

export const removeComment = mutation({
  args: { commentId: v.string() },
  returns: v.null(),
  handler: async (ctx, { commentId }) =>
    comments.remove(ctx, commentId, await authorOf(ctx)),
});
```

Store a structured body and validate it on write and read with a plain
function (any schema library's parse function works the same way):

```ts
// convex/notes.ts
import { Comments } from "@vllnt/convex-comments";
import { v } from "convex/values";

import { components } from "./_generated/api";
import { internalMutation } from "./_generated/server";

interface NoteBody {
  text: string;
  mentions: string[];
}

const parseNoteBody = (value: unknown): NoteBody => {
  if (
    typeof value === "object" &&
    value !== null &&
    "text" in value &&
    typeof value.text === "string" &&
    "mentions" in value &&
    Array.isArray(value.mentions) &&
    value.mentions.every((item) => typeof item === "string")
  ) {
    return { text: value.text, mentions: value.mentions };
  }
  throw new Error("invalid note body");
};

const notes = new Comments<NoteBody>(components.comments, {
  bodyValidator: parseNoteBody,
});

export const addNote = internalMutation({
  args: { resourceRef: v.string(), authorRef: v.string(), text: v.string() },
  returns: v.string(),
  handler: async (ctx, { resourceRef, authorRef, text }) => {
    const { commentId } = await notes.post(ctx, resourceRef, authorRef, {
      text,
      mentions: [],
    });
    return commentId;
  },
});
```

Mount a second, fully separate instance for annotations. Named mounts share no
rows, counters or cron:

```ts
// convex/convex.config.ts
import comments from "@vllnt/convex-comments/convex.config";
import { defineApp } from "convex/server";

const app = defineApp();
app.use(comments);
app.use(comments, { name: "annotations" });
export default app;
```

```ts
// convex/clients.ts
import { Comments } from "@vllnt/convex-comments";

import { components } from "./_generated/api";

export const discussion = new Comments<string>(components.comments);
export const annotations = new Comments<string>(components.annotations);
```

Prune soft-deleted comments sooner than the built-in 30 days, from your own
scheduler (the built-in daily cron keeps running):

```ts
// convex/retention.ts
import { Comments } from "@vllnt/convex-comments";
import { v } from "convex/values";

import { components } from "./_generated/api";
import { internalMutation } from "./_generated/server";

const comments = new Comments(components.comments);
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export const pruneWeek = internalMutation({
  args: {},
  returns: v.number(),
  handler: (ctx) => comments.prune(ctx, { before: Date.now() - SEVEN_DAYS_MS }),
});
```

## Errors and fixes

The component throws a `ConvexError` whose `data` is `{ code, message }`. Catch
it in the host with `error instanceof ConvexError` and read `error.data.code`.

| Code               | Thrown by                   | Cause                                                       | Fix                                                                     |
| ------------------ | --------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| `INVALID_REF`      | `post`                      | `resourceRef` or `authorRef` is the empty string            | Pass non-empty refs; resolve the author before calling `post`           |
| `PARENT_NOT_FOUND` | `post`                      | `parentId` names no comment (never existed or was pruned)   | Reply to an existing comment, or post at the top level                  |
| `PARENT_MISMATCH`  | `post`                      | The parent belongs to a different `resourceRef`             | Pass the parent's own `resourceRef`                                     |
| `PARENT_DELETED`   | `post`                      | The parent is soft-deleted                                  | Post at the top level, or reply to a comment that is not deleted        |
| `NOT_FOUND`        | `edit`, `remove`, `resolve` | No comment has this `commentId` (never existed or was pruned) | Check the id; `get` returns `null` for it                             |
| `NOT_AUTHOR`       | `edit`, `remove`, `resolve` | `authorRef` is not the comment's author                     | Pass the original author's ref; moderation is the host's own code       |
| `DELETED`          | `edit`, `resolve`           | The comment is soft-deleted                                 | Nothing to change; a deleted comment cannot be edited or resolved       |
| `INVALID_BATCH`    | `prune`                     | `batch` is not an integer from 1 to 500                     | Pass an integer from 1 to 500, or omit it (default 200)                 |
| `INVALID_BEFORE`   | `prune`                     | `before` is `NaN` or infinite                               | Pass a finite millisecond timestamp, or omit it (default now − 30 days) |

Not coded: a `commentId` or `parentId` that is not an id of the component's
`comments` table, and arguments of the wrong type, fail Convex argument
validation before the component runs. A `bodyValidator` that throws surfaces its
own error unchanged.

## Limits and gotchas

- `prune` batch: integer 1–500, default 200. `before` defaults to the server
  clock minus 30 days. Only soft-deleted comments are pruned; open and resolved
  ones are kept forever.
- The built-in daily cron prunes with the 30-day default and cannot be turned
  off or reconfigured. A custom `prune` with a longer window does not keep
  comments longer than 30 days.
- A soft-deleted comment that still has replies is never pruned, so its replies
  never lose their parent. It is pruned once it has no replies left.
- `INVALID_REF` is checked only by `post`. `edit`, `remove` and `resolve`
  compare `authorRef` as given, so a comment stored by 0.1.0 with an empty
  `authorRef` accepts any caller that passes `""`. Reject an empty `authorRef`
  in the host before calling them.
- Refs have no length or format check beyond non-empty; the body is limited
  only by Convex's document size limit.
- `count` reads one `resourceCounts` row per resource, created by the first
  `post` on a resource with no comments. A resource whose comments existed
  before that row (from 0.1.0) keeps scanning all its comments on every `count`.
  `count` includes replies.
- After a downgrade to 0.1.x and a new upgrade, `resourceCounts` is stale: delete
  every row of the component's `resourceCounts` table before upgrading again.
- `list` returns top-level comments by default and only direct replies with
  `{ parentId }`; there is no whole-tree read. A `parentId` from another resource
  returns an empty page.
- The body is opaque. Without `bodyValidator`, `TBody` is an unchecked type. With
  it, the parser runs on write (`post`, `edit`) and on read (`get`, `list`); a
  stored body that fails it makes the whole read throw.
- Calls that change nothing and raise no error: `remove` on a deleted comment
  by its author (anyone else gets `NOT_AUTHOR` first), `resolve` to the state
  it already has (`updatedAt` stays the same).
- `edit` keeps the status; editing a resolved comment leaves it resolved.
- There is no method to list comments by author.
- `get`, `list` and `count` check nothing: anyone who can call your query
  wrapper reads the thread.

## Compatibility

- Peer dependency: `convex@^1.45.0`. Development, unit tests and the docs check
  run on the locked convex version (1.51.0). The 1.45.0 floor is not tested in
  CI.
- Node.js: `engines` is `>=20`, the minimum of the `convex@1.45.0` floor;
  convex 1.49 and later need Node.js 22 or later. CI runs Node.js 24.
- ES modules only. The component functions run in the default Convex runtime
  (no Node.js actions).
- `@vllnt/convex-comments/test` ships as TypeScript source and needs Vite's
  `import.meta.glob`; it type-checks with `moduleResolution` `Bundler` and
  `NodeNext`. On convex 1.45.x use convex-test 0.0.71 or earlier: 0.0.72 and
  later need `convex@^1.46.0`.
- React: not applicable. The package is backend-only and has no `./react` entry;
  call your own wrappers with `useQuery` or `usePaginatedQuery`. For a web UI,
  ui.vllnt.com has [Comment Pin](https://ui.vllnt.com/components/comment-pin)
  and [Thread Bubble](https://ui.vllnt.com/components/thread-bubble) components
  for anchored comment threads; this package does not depend on them.

## Testing

Mount the component in your own `convex-test` suite with `register`. You need
`convex-test`, `vitest`, `vite` and `@edge-runtime/vm` as dev dependencies, and
the Vitest settings `convex-test` recommends:

```ts
// vitest.config.mts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
  },
});
```

```ts
// convex/comments.test.ts
/// <reference types="vite/client" />
import { register } from "@vllnt/convex-comments/test";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

test("a reply threads under its parent", async () => {
  const t = convexTest(schema, import.meta.glob("./**/*.ts"));
  register(t);
  const alice = t.withIdentity({ tokenIdentifier: "alice" });
  const parentId = await alice.mutation(api.comments.post, {
    resourceRef: "doc:1",
    body: "first",
  });
  await alice.mutation(api.comments.post, {
    resourceRef: "doc:1",
    body: "reply",
    parentId,
  });
  const top = await alice.query(api.comments.thread, {
    resourceRef: "doc:1",
    paginationOpts: { cursor: null, numItems: 10 },
  });
  expect(top.page.map((comment) => comment.body)).toEqual(["first"]);
});
```

`register(t, name)` takes the mount name when you used
`app.use(comments, { name })`. The test imports your own `convex/schema.ts`
(`./schema`); a host with no tables can export `defineSchema({})`. The
`import.meta.glob` must include your `convex/_generated` folder: `convex-test`
finds your functions from it.

This repository's own tests run on the `convex-test` runtime
(`pnpm test:coverage`, 100% coverage enforced). `pnpm check:docs` type-checks
every README `ts` example against the built package and runs the test above.

## Security

- The component does not authenticate. The host decides who may post on a
  resource and who may moderate; derive `authorRef` on the server, never accept
  it from the client.
- The one rule the component enforces: only the original `authorRef` may edit,
  remove or resolve a comment.
- Its tables are reachable only through the component's functions; it reads no
  host tables. Timestamps come from the server clock.
- `remove` clears the body at once; the row stays until it is pruned.

Report vulnerabilities as described in
[SECURITY.md](https://github.com/vllnt/convex-comments/blob/main/SECURITY.md).

## Related packages

None. This package has no runtime dependency, shared test or example with
another @vllnt package.

## Contributing

See
[CONTRIBUTING.md](https://github.com/vllnt/convex-comments/blob/main/CONTRIBUTING.md).

## Links

- Docs and changelog: [oss.vllnt.com/packages/convex-comments](https://oss.vllnt.com/packages/convex-comments) · [release feed](https://oss.vllnt.com/packages/convex-comments/rss.xml)
- All @vllnt packages: [oss.vllnt.com](https://oss.vllnt.com) · [search packages and docs on index.vllnt.com](https://index.vllnt.com)
- Source and issues: [GitHub](https://github.com/vllnt/convex-comments) · [issues](https://github.com/vllnt/convex-comments/issues) · [npm](https://www.npmjs.com/package/@vllnt/convex-comments)
- Questions and updates: [Discord](https://bntvllnt.com/discord) · [X @bntvllnt](https://x.com/bntvllnt)
- Company and author: [vllnt.com](https://vllnt.com) · [bntvllnt.com](https://bntvllnt.com) · [GitHub @bntvllnt](https://github.com/bntvllnt) · [LinkedIn](https://linkedin.com/in/bntvllnt)
- Sponsor: [GitHub Sponsors](https://github.com/sponsors/bntvllnt)

## License

MIT. See [LICENSE](LICENSE).

[![npm](https://img.shields.io/npm/v/@vllnt/convex-comments.svg)](https://www.npmjs.com/package/@vllnt/convex-comments)
[![CI](https://github.com/vllnt/convex-comments/actions/workflows/ci.yml/badge.svg)](https://github.com/vllnt/convex-comments/actions/workflows/ci.yml)

---

Part of [vllnt open source](https://oss.vllnt.com) · [Package page](https://oss.vllnt.com/packages/convex-comments) · [vllnt.com](https://vllnt.com) · Built by [bntvllnt](https://bntvllnt.com)
