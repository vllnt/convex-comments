# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - Unreleased

A minor release, not a patch: it adds the `resourceCounts` component table and `post` now
rejects empty refs that 0.1.0 accepted, so `^0.1.0` ranges do not pick it up silently.

### Added

- The npm package now ships `docs/API.md`, `CHANGELOG.md` and `llms.txt` (next to the README and
  LICENSE it already carried), so coding agents can read docs that match the installed version
  from `node_modules/@vllnt/convex-comments/`. `llms.txt` links to shipped files relatively.
  `pnpm test:package`, run in CI, fails when a required doc or an `exports` target is missing
  from the tarball, an unexpected file ships, or a `README.md` / `llms.txt` link does not
  resolve inside the tarball.
- `docs/API.md` documents every entry point (`.`, `./convex.config`, `./test`,
  `./_generated/component`) and the exported types.
- `pnpm check:docs`, run in CI, fails when a README section is missing or out of order, a code
  block has no language, a relative link does not resolve, an export or error code is not
  documented, a README example does not type-check against `dist`, or the shared Links, footer or
  Ecosystem block differs.

### Changed

- Docs rewritten for coding agents. The README follows the shared @vllnt section order (For
  coding agents, When to use, Install, Quick start, API, Common tasks, Errors and fixes, Limits
  and gotchas, Compatibility, Testing, Security, Related packages, Contributing, Links, License)
  and every README `ts` example type-checks against the built package. `docs/API.md` holds
  signatures, not examples, and has one heading per export and a single error-codes table;
  `llms.txt` carries the same summary, when-to-use list and links. The `package.json`
  `description` and `keywords` changed to match. The README no longer lists `@vllnt/convex-reactions`,
  `@vllnt/convex-notifications` or `@vllnt/convex-permissions` as related packages: no code,
  test or example here uses them.
- A push to `main` publishes a canary automatically (under the `canary` dist-tag only); the
  repository-variable gate on canary publishing is removed. Docs-only changes to the shipped
  files also trigger it.
- `homepage` now points to `https://oss.vllnt.com/packages/convex-comments`.
- **Breaking:** `post` rejects an empty `resourceRef` or `authorRef` with
  `ConvexError({ code: "INVALID_REF" })`; 0.1.0 accepted them. Callers that passed `""` must
  pass a non-empty ref. Comments stored by 0.1.0 with an empty `authorRef` still exist, and since
  only `post` checks refs, `edit`, `remove` and `resolve` accept a caller passing `""` as their
  author: hosts should reject an empty `authorRef` before calling those.
- `count` reads a maintained `resourceCounts` row (one document) instead of collecting every comment
  on the resource. The counter is created by the first `post` on a resource with no comments, and
  only `post` and `remove` change it, so for a resource with a counter `count` re-runs only when a
  comment is posted or removed. Resources whose comments predate the counter have no row and keep
  the previous scan (and its reactivity: `count` re-runs on any change to the resource's comments),
  so no write ever scans a whole resource.
- Upgrading again after a downgrade needs a cleanup: if you run 0.2.0, go back to 0.1.x and later
  upgrade again, the `resourceCounts` rows missed every post and remove made under 0.1.x, so `count`
  returns stale numbers. Before upgrading again, delete every row in the component's
  `resourceCounts` table: `count` then falls back to the scan for each resource that has comments,
  which stays correct, and a resource with no comments gets a fresh counter on its next `post`.

### Fixed

- `register(t)` from `@vllnt/convex-comments/test` accepts the `convexTest(schema, modules)`
  instance of any host schema. It was typed against the component's own schema, so a host
  app's test failed to type-check with TS2345. Runtime behavior is unchanged. The repo's
  tests (`example/**`, `src/**/*.test.ts`) are now type-checked by `pnpm typecheck:tests`,
  which `pnpm test` and `pnpm test:coverage` run first.
- The publish workflow runs `pnpm test:package` in its quality gate, so a canary or stable
  release no longer publishes a tarball that misses a required doc or `exports` target.
  `pnpm check:release` (run by `pnpm lint`) fails if that gate or the existing release
  guards are removed.
- `@vllnt/convex-comments/test` now type-checks under `moduleResolution: nodenext`
  (explicit `.js` relative imports, Vite client types referenced).
- The `bodyValidator` JSDoc in `src/client` no longer says a Convex `v.*` validator has a
  `.parse`; it does not. `llms.txt` now lists both tables (`comments` and `resourceCounts`) and
  the `{ commentId }` result of `post`.

## [0.1.0] - 2026-09-01

### Added

- First release of `@vllnt/convex-comments` — threaded comments / annotations on
  any resource.
- `post(resourceRef, authorRef, body, parentId?)` attaches an `open` comment to an
  opaque resource and returns its id; `parentId` threads it as a reply to an
  existing, non-deleted comment on the same resource.
- `edit(commentId, authorRef, body)`, `remove(commentId, authorRef)` (soft-delete),
  and `resolve(commentId, authorRef, resolved?)` (toggle) all require the original
  author — a non-author caller is rejected with
  `ConvexError({ code: "NOT_AUTHOR" })`.
- `get(commentId)` returns the current view (or `null`); `list(resourceRef,
  paginationOpts, { parentId?, includeDeleted? })` pages a resource's thread (or
  one comment's replies) oldest-first via the standard Convex pagination envelope;
  `count(resourceRef)` tallies the visible comments.
- Soft-delete preserves the reply subtree: the row is kept, marked `deleted`, and
  its body cleared; a default `list` excludes it.
- Threading integrity: a reply's parent must exist (`PARENT_NOT_FOUND`), be
  non-deleted (`PARENT_DELETED`), and live on the same resource (`PARENT_MISMATCH`).
- Server-sourced time: every handler stamps `createdAt`/`updatedAt`/`editedAt` from
  `Date.now()` inside the mutation — no caller-supplied clock.
- Typed generics: `Comments<TBody>` with an optional `bodyValidator` host parser
  narrowing the opaque stored `body` at the client boundary on write and read — no
  `v.any()` dump, no unchecked cast.
- Bounded, self-rescheduling `prune` (`take(batch)` + scheduler) that removes only
  soft-deleted comments past their `updatedAt` cutoff, plus a built-in daily prune
  cron (`crons.ts`); idempotent. Default retention 30 days.
- Mount-safe: correct under multiple `app.use(component, { name })` mounts — each
  instance is sandboxed, the cron is registered per instance.

### Fixed

- Apply the documented 30-day default retention window instead of pruning newly deleted
  comments immediately.
- Preserve deleted parent tombstones while replies exist and paginate retention scans so blocked
  parents cannot starve later eligible rows.
- Reject invalid prune batch sizes before querying or self-scheduling.

### Changed

- Treat Convex `_generated` output as CLI-owned, exclude it from formatting, and expose a
  dedicated codegen script.
- Refresh all direct dependencies to their latest compatible releases for canary validation.
- Require `convex@^1.45.0` and update `convex-test` to `^0.0.56`.
