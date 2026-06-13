import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
  PaginationOptions,
  PaginationResult,
} from "convex/server";
import type {
  CommentStatus,
  CommentView,
  CommentsOptions,
  ListOptions,
  Parser,
} from "./types.js";
import { DEFAULT_PRUNE_BATCH } from "../shared.js";

/**
 * The component's raw comment view, before the client narrows the opaque host
 * body. `body` is `unknown` here; the {@link Comments} client runs the host
 * validator over it at its typed boundary.
 */
type RawView = {
  commentId: string;
  resourceRef: string;
  authorRef: string;
  parentId?: string;
  body?: unknown;
  status: CommentStatus;
  editedAt?: number;
  createdAt: number;
  updatedAt: number;
};

/**
 * The comments component's function references, as exposed on the host via
 * `components.comments`. The host's stored `body` is opaque here (`unknown`); the
 * {@link Comments} client narrows it at its own typed boundary.
 */
export interface CommentsComponent {
  mutations: {
    post: FunctionReference<
      "mutation",
      "internal",
      {
        resourceRef: string;
        authorRef: string;
        body: unknown;
        parentId?: string;
      },
      { commentId: string }
    >;
    edit: FunctionReference<
      "mutation",
      "internal",
      { commentId: string; authorRef: string; body: unknown },
      null
    >;
    remove: FunctionReference<
      "mutation",
      "internal",
      { commentId: string; authorRef: string },
      null
    >;
    resolve: FunctionReference<
      "mutation",
      "internal",
      { commentId: string; authorRef: string; resolved: boolean },
      null
    >;
    prune: FunctionReference<
      "mutation",
      "internal",
      { before?: number; batch: number },
      number
    >;
  };
  queries: {
    get: FunctionReference<
      "query",
      "internal",
      { commentId: string },
      RawView | null
    >;
    list: FunctionReference<
      "query",
      "internal",
      {
        resourceRef: string;
        parentId?: string;
        includeDeleted?: boolean;
        paginationOpts: PaginationOptions;
      },
      PaginationResult<RawView>
    >;
    count: FunctionReference<
      "query",
      "internal",
      { resourceRef: string },
      number
    >;
  };
}

interface RunQueryCtx {
  runQuery<Q extends FunctionReference<"query", "internal">>(
    reference: Q,
    args: FunctionArgs<Q>,
  ): Promise<FunctionReturnType<Q>>;
}

interface RunMutationCtx {
  runMutation<M extends FunctionReference<"mutation", "internal">>(
    reference: M,
    args: FunctionArgs<M>,
  ): Promise<FunctionReturnType<M>>;
}

/**
 * Consumer-facing client for threaded comments / annotations on any resource. A
 * host mutation calls `post(resourceRef, authorRef, body, parentId?)` to attach a
 * comment to an opaque resource; `edit` / `remove` / `resolve` mutate it
 * (author-gated by the component); `list` pages a resource's thread and `count`
 * tallies it. The host owns meaning and auth — it resolves identity, decides
 * access, and passes opaque `resourceRef` / `authorRef`. The body is opaque host
 * data the component stores without inspecting; pass `bodyValidator` to narrow it
 * to `TBody` at the boundary (plain text vs rich blocks — the host decides).
 *
 * @typeParam TBody - The host's comment body type (defaults to `unknown`).
 *
 * @example
 * ```ts
 * const comments = new Comments(components.comments, {
 *   bodyValidator: v.string().parse,
 * });
 * const { commentId } = await comments.post(ctx, "post:42", "user:7", "hello");
 * const reply = await comments.post(ctx, "post:42", "user:9", "hi", commentId);
 * const thread = await comments.list(ctx, "post:42", { cursor: null, numItems: 50 });
 * ```
 */
export class Comments<TBody = unknown> {
  private readonly bodyValidator: Parser<TBody> | undefined;

  constructor(
    private readonly component: CommentsComponent,
    options: CommentsOptions<TBody> = {},
  ) {
    this.bodyValidator = options.bodyValidator;
  }

  /** Narrow an opaque value through the host parser; pass `undefined` and an unset parser through. */
  private parse(value: unknown): TBody | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (this.bodyValidator === undefined) {
      return value as TBody;
    }
    return this.bodyValidator(value);
  }

  /** Project a raw component view into the typed, validated client view. */
  private view(raw: RawView): CommentView<TBody> {
    return {
      commentId: raw.commentId,
      resourceRef: raw.resourceRef,
      authorRef: raw.authorRef,
      parentId: raw.parentId,
      body: this.parse(raw.body),
      status: raw.status,
      editedAt: raw.editedAt,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  }

  /**
   * Post a comment on `resourceRef` authored by `authorRef` and return its id.
   * `body` is opaque host data validated against `bodyValidator` before storage.
   * `parentId`, when given, threads the comment as a reply. The comment starts
   * `open`.
   */
  async post(
    ctx: RunMutationCtx,
    resourceRef: string,
    authorRef: string,
    body: TBody,
    parentId?: string,
  ): Promise<{ commentId: string }> {
    return ctx.runMutation(this.component.mutations.post, {
      resourceRef,
      authorRef,
      body: this.parse(body),
      parentId,
    });
  }

  /**
   * Edit a comment's body. The component rejects a non-author caller and a
   * soft-deleted comment. `body` is validated against `bodyValidator` before
   * storage.
   */
  edit(
    ctx: RunMutationCtx,
    commentId: string,
    authorRef: string,
    body: TBody,
  ): Promise<null> {
    return ctx.runMutation(this.component.mutations.edit, {
      commentId,
      authorRef,
      body: this.parse(body),
    });
  }

  /** Soft-delete a comment (author-gated by the component); replies are preserved. */
  remove(
    ctx: RunMutationCtx,
    commentId: string,
    authorRef: string,
  ): Promise<null> {
    return ctx.runMutation(this.component.mutations.remove, {
      commentId,
      authorRef,
    });
  }

  /** Toggle a comment's resolved state (author-gated); `resolved` defaults to `true`. */
  resolve(
    ctx: RunMutationCtx,
    commentId: string,
    authorRef: string,
    resolved = true,
  ): Promise<null> {
    return ctx.runMutation(this.component.mutations.resolve, {
      commentId,
      authorRef,
      resolved,
    });
  }

  /** The current view of `commentId`, or `null` if no such comment is held. */
  async get(
    ctx: RunQueryCtx,
    commentId: string,
  ): Promise<CommentView<TBody> | null> {
    const raw = await ctx.runQuery(this.component.queries.get, { commentId });
    return raw === null ? null : this.view(raw);
  }

  /**
   * Page a resource's comments oldest first. By default pages the resource's
   * top level (excluding soft-deleted); pass `opts.parentId` to page one
   * comment's replies, or `opts.includeDeleted` to include removed comments.
   * Returns the standard Convex pagination envelope with each row narrowed.
   */
  async list(
    ctx: RunQueryCtx,
    resourceRef: string,
    paginationOpts: PaginationOptions,
    opts: ListOptions = {},
  ): Promise<PaginationResult<CommentView<TBody>>> {
    const result = await ctx.runQuery(this.component.queries.list, {
      resourceRef,
      parentId: opts.parentId,
      includeDeleted: opts.includeDeleted,
      paginationOpts,
    });
    return { ...result, page: result.page.map((raw) => this.view(raw)) };
  }

  /** Count the visible (non-deleted) comments on `resourceRef`. */
  count(ctx: RunQueryCtx, resourceRef: string): Promise<number> {
    return ctx.runQuery(this.component.queries.count, { resourceRef });
  }

  /**
   * Delete soft-deleted comments whose `updatedAt < before` in bounded batches,
   * oldest first. `before` defaults to the server clock; `batch` caps each pass
   * and the sweep self-reschedules until the tail is clean. Returns the count
   * removed in the first pass. The built-in daily cron drives this automatically.
   */
  prune(
    ctx: RunMutationCtx,
    opts: { before?: number; batch?: number } = {},
  ): Promise<number> {
    return ctx.runMutation(this.component.mutations.prune, {
      before: opts.before,
      batch: opts.batch ?? DEFAULT_PRUNE_BATCH,
    });
  }
}

export type {
  CommentStatus,
  CommentView,
  CommentsOptions,
  ListOptions,
  Parser,
};
