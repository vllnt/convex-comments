import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { components } from "./_generated/api";
import { register } from "../../src/test";

const modules = import.meta.glob("./**/*.ts");

// A host schema with its own table and no `comments` table. `register` must
// accept the `convexTest` instance built from it; `pnpm typecheck:tests` fails
// with TS2345 if `register` is typed against the component schema instead.
const hostSchema = defineSchema({
  notes: defineTable({ text: v.string() }),
});

describe("register — host schemas", () => {
  test("mounts the component on a host convexTest instance, default and named", async () => {
    const t = convexTest(hostSchema, modules);
    register(t);
    register(t, "annotations");

    const noteId = await t.run((ctx) => ctx.db.insert("notes", { text: "n" }));
    expect((await t.run((ctx) => ctx.db.get(noteId)))?.text).toBe("n");

    const { commentId } = await t.mutation(components.comments.mutations.post, {
      resourceRef: "note:1",
      authorRef: "user:1",
      body: "hi",
    });
    expect(commentId).toBeTruthy();
    expect(
      await t.query(components.comments.queries.count, {
        resourceRef: "note:1",
      }),
    ).toBe(1);
    expect(
      await t.query(components.annotations.queries.count, {
        resourceRef: "note:1",
      }),
    ).toBe(0);
  });

  test("a mount that was not registered cannot be called", async () => {
    const t = convexTest(hostSchema, modules);
    register(t);
    await expect(
      t.query(components.annotations.queries.count, { resourceRef: "note:1" }),
    ).rejects.toThrow(/Component "annotations" is not registered/);
  });
});
