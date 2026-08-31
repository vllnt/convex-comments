<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `example/convex/_generated/ai/guidelines.md` first** for
important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->

# @vllnt/convex-comments

Threaded comments / annotations on any resource, as a Convex component. A host attaches a comment to
an opaque `resourceRef`; replies thread under a parent; the original author edits, resolves, and
soft-deletes their own comments; clients page a resource's thread (or subscribe reactively). It
follows the vllnt Component Standard (see the `oss-packages` hub `AGENTS.md`).

## Agent instructions

`AGENTS.md` is the sole agent-instruction source for this repository. Do not add
`CLAUDE.md` or `.claude` content.

## Architecture

```
src/
├── shared.ts              # constants: component name, lifecycle statuses, retention, batch size
├── test.ts                # convex-test register() helper
├── client/
│   ├── index.ts           # Comments<TBody> class (consumer-facing API)
│   └── types.ts           # public TypeScript interfaces
└── component/
    ├── schema.ts           # sandboxed table: comments {resourceRef, authorRef, parentId?, body?, status, editedAt?, createdAt, updatedAt}
    ├── convex.config.ts    # defineComponent("comments")
    ├── mutations.ts        # post, edit, remove, resolve, prune
    ├── queries.ts          # get, list, count
    ├── validators.ts       # shared validators (commentStatus, visibleStatus, commentView, jsonValue)
    └── crons.ts            # daily prune cron (self-rescheduling)
```

Sandboxed table: `comments` — indexed `by_resource` (resource listing + count), `by_resource_parent`
(reply listing), `by_author` (author listing), and `by_status_updated` (retention sweep). No host
tables are touched. The stored `body` is opaque to the component; the host narrows it via `bodyValidator`
at the client boundary.

## Ownership boundary

**Component owns:**

- The comment tree (`comments` table) — post, reply, edit, resolve, soft-delete, prune
- Server-sourced time — `Date.now()` inside every handler stamps `createdAt`/`updatedAt`/`editedAt`; no caller clock
- The authorship invariant — only the original `authorRef` may edit, remove, or resolve a comment
- Threading integrity — a reply's parent must exist, be non-deleted, and live on the same resource
- The daily prune cron and `prune` mutation (soft-deleted comments past retention only)

**Host owns:**

- The resource being commented on and the author identity (`resourceRef`, `authorRef` — opaque refs)
- Auth and authorization — who may post on a resource, who may moderate (the component enforces only authorship)
- The body shape (`TBody`) — plain text vs rich blocks — opaque to the component, narrowed by the host validator
- The meaning of a comment (a discussion reply, an inline annotation, a review note)

**Auth:** the component is auth-agnostic for access, enforcing only authorship of mutations. The host
resolves identity, decides who may post/moderate, and passes opaque `resourceRef` / `authorRef`. There
is no built-in scope dimension — the resource ref already namespaces; for a static partition (discussion
vs annotations) mount a second instance (`app.use(component, { name })`).

## Key design decisions

- **Authorship is the component's one access invariant:** `edit` / `remove` / `resolve` reject a caller
  whose `authorRef` is not the comment's author with `ConvexError({ code: "NOT_AUTHOR" })`. The component
  deliberately enforces nothing broader — who may post on a resource or moderate it is the host's auth
  decision. Keeping the surface to authorship makes the component domain-neutral.

- **Soft-delete preserves the thread:** `remove` keeps the row and its replies, moving it to `deleted`
  and clearing the body (so removed content does not linger). A default `list` excludes `deleted`; the
  prune cron sweeps the row after the retention window. Hard-deleting would orphan a reply subtree.

- **Server-sourced time:** every handler stamps `createdAt`/`updatedAt`/`editedAt` from `Date.now()`
  internally; no API surface accepts a caller-supplied timestamp. Ordering and retention cannot be skewed
  by a client clock.

- **Threading integrity is checked on `post`:** a `parentId` must name an existing, non-deleted comment
  on the SAME resource (`PARENT_NOT_FOUND` / `PARENT_MISMATCH` / `PARENT_DELETED`). A reply can never
  dangle off a missing parent or cross a resource boundary.

- **Typed-generic opaque body, never `v.any()` dumped raw:** the comment `body` rides through the single
  documented `jsonValue` alias and is narrowed to `TBody` by the host `bodyValidator` at the client
  boundary on both write and read — no unchecked cast. Plain text needs no validator; a rich-block host
  passes its schema.

- **`status`-coupled clears on write:** `remove` clears `body` as it sets `deleted`; `resolve` toggles
  `open ↔ resolved` idempotently — a removed comment never carries stale body content, and re-setting a
  state is a no-op (the `updatedAt` clock does not advance).

- **Bounded prune + self-reschedule (deleted-only):** `prune` removes up to `batch` soft-deleted comments
  (default 200) past their `updatedAt` cutoff per pass and self-reschedules via `ctx.scheduler` when a
  full batch was removed. Open/resolved comments are never swept. Idempotent; the built-in daily cron
  drives it automatically. Default retention 30 days.

- **Backend-only (no `./react` entry):** a comment thread is an ordinary reactive `useQuery` /
  `usePaginatedQuery` over the host's own re-exported `list`/`count` refs — a dedicated hook would wrap
  the host's `api` with no added value. Explicit analysis decision (see README); re-run when a real
  shared management surface consumer appears.

## Conventions

- Mutations in `mutations.ts`, queries in `queries.ts` (enforced by `@vllnt/eslint-config/convex`).
- Explicit `args` + `returns` on every Convex function.
- Host data via typed generics / host validators — never `v.any()` dumps; `jsonValue` is the documented
  last resort for the stored opaque `body`.
- 100% test coverage is BLOCKING (`vitest.config.mts` thresholds: statements, branches, functions, lines).
- Runtime deps: only official `@convex-dev/*` + `@vllnt/*`.

## Docs sync

| Changed | Update in the same commit |
|---------|--------------------------|
| Public API (post/edit/remove/resolve/get/list/count/prune signatures) | README API Reference table, `docs/API.md`, `llms.txt` context, regenerate `llms-full.txt` |
| Config options / defaults (body validator, retention, batch) | README API Reference, `docs/API.md` constructor section |
| Schema / table / indexes | README Architecture, `docs/API.md` |
| Error codes | `docs/API.md` → `## Error codes` table |
| `peerDependencies.convex` version | `llms.txt` context line (`convex@^X.Y.Z`), `docs/API.md` Compatibility line, README Installation peer note |
| Lifecycle / status / threading rules | `docs/API.md` mutation sections, Key design decisions above |
| Any change | `pnpm generate:llms` to keep `llms-full.txt` current |

Grep old values before committing (e.g. after a `peerDependencies.convex` bump, `git grep "1.41.0"` → only the new range survives).

## Generated code

- Every `**/_generated/**` file is owned exclusively by Convex CLI codegen.
- Never create, edit, lint, or format generated files manually.
- Run `pnpm codegen` to regenerate them and commit the generated output unchanged.
