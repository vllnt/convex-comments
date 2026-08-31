/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    mutations: {
      edit: FunctionReference<
        "mutation",
        "internal",
        { authorRef: string; body: any; commentId: string },
        null,
        Name
      >;
      post: FunctionReference<
        "mutation",
        "internal",
        {
          authorRef: string;
          body: any;
          parentId?: string;
          resourceRef: string;
        },
        { commentId: string },
        Name
      >;
      prune: FunctionReference<
        "mutation",
        "internal",
        { batch: number; before?: number },
        number,
        Name
      >;
      remove: FunctionReference<
        "mutation",
        "internal",
        { authorRef: string; commentId: string },
        null,
        Name
      >;
      resolve: FunctionReference<
        "mutation",
        "internal",
        { authorRef: string; commentId: string; resolved: boolean },
        null,
        Name
      >;
    };
    queries: {
      count: FunctionReference<
        "query",
        "internal",
        { resourceRef: string },
        number,
        Name
      >;
      get: FunctionReference<
        "query",
        "internal",
        { commentId: string },
        null | {
          authorRef: string;
          body?: any;
          commentId: string;
          createdAt: number;
          editedAt?: number;
          parentId?: string;
          resourceRef: string;
          status: "open" | "resolved" | "deleted";
          updatedAt: number;
        },
        Name
      >;
      list: FunctionReference<
        "query",
        "internal",
        {
          includeDeleted?: boolean;
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
          parentId?: string;
          resourceRef: string;
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            authorRef: string;
            body?: any;
            commentId: string;
            createdAt: number;
            editedAt?: number;
            parentId?: string;
            resourceRef: string;
            status: "open" | "resolved" | "deleted";
            updatedAt: number;
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        },
        Name
      >;
    };
  };
