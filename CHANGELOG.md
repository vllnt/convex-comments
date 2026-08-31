# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Refresh all direct dependencies to their latest compatible releases for canary validation.
- Require `convex@^1.45.0` and update `convex-test` to `^0.0.56`.

## [0.1.0] - 2026-06-14

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
