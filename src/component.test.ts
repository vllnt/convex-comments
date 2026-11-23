/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./component/_generated/api.js";
import schema from "./component/schema.js";

const modules = import.meta.glob("./component/**/*.ts");

function setup() {
  return convexTest(schema, modules);
}

async function insertLegacy(t: ReturnType<typeof setup>, status: "open" | "resolved" | "deleted") {
  await t.run(async (ctx) => {
    await ctx.db.insert("comments", {
      resourceRef: "doc",
      authorRef: "legacy",
      body: "x",
      status,
      createdAt: 0,
      updatedAt: 0,
    });
  });
}

describe("comments component — maintained visible count", () => {
  test("count reads the maintained counter instead of scanning comments", async () => {
    const t = setup();
    await t.mutation(api.mutations.post, { resourceRef: "doc", authorRef: "a", body: "hi" });
    await insertLegacy(t, "open");
    expect(await t.query(api.queries.count, { resourceRef: "doc" })).toBe(1);
    const counters = await t.run((ctx) => ctx.db.query("resourceCounts").collect());
    expect(counters).toMatchObject([{ resourceRef: "doc", visible: 1 }]);
  });

  test("legacy resources stay on the scan fallback and never get a partial counter", async () => {
    const t = setup();
    await insertLegacy(t, "open");
    await insertLegacy(t, "resolved");
    await insertLegacy(t, "deleted");
    expect(await t.query(api.queries.count, { resourceRef: "doc" })).toBe(2);
    await t.mutation(api.mutations.post, { resourceRef: "doc", authorRef: "a", body: "hi" });
    expect(await t.query(api.queries.count, { resourceRef: "doc" })).toBe(3);
    expect(await t.run((ctx) => ctx.db.query("resourceCounts").collect())).toEqual([]);
  });

  test("remove on a legacy resource stays exact through the fallback; repeat remove is a no-op", async () => {
    const t = setup();
    await insertLegacy(t, "open");
    const legacyId = await t.run(async (ctx) => (await ctx.db.query("comments").first())?._id);
    expect(legacyId).toBeDefined();
    if (legacyId === undefined) return;
    await t.mutation(api.mutations.remove, { commentId: legacyId, authorRef: "legacy" });
    await t.mutation(api.mutations.remove, { commentId: legacyId, authorRef: "legacy" });
    expect(await t.query(api.queries.count, { resourceRef: "doc" })).toBe(0);
  });

  test("resolve and reopen keep the count; remove decrements; other resources are independent", async () => {
    const t = setup();
    const { commentId } = await t.mutation(api.mutations.post, { resourceRef: "doc", authorRef: "a", body: "1" });
    await t.mutation(api.mutations.post, { resourceRef: "doc", authorRef: "b", body: "2", parentId: commentId });
    await t.mutation(api.mutations.post, { resourceRef: "other", authorRef: "a", body: "3" });
    await t.mutation(api.mutations.resolve, { commentId, authorRef: "a", resolved: true });
    expect(await t.query(api.queries.count, { resourceRef: "doc" })).toBe(2);
    await t.mutation(api.mutations.resolve, { commentId, authorRef: "a", resolved: false });
    await t.mutation(api.mutations.remove, { commentId, authorRef: "a" });
    expect(await t.query(api.queries.count, { resourceRef: "doc" })).toBe(1);
    expect(await t.query(api.queries.count, { resourceRef: "other" })).toBe(1);
  });
});

describe("comments component — writes stay within transaction limits", () => {
  test("post and remove succeed on a legacy resource larger than the read limit", async () => {
    const t = convexTest({ schema, modules, transactionLimits: true });
    const body = "x".repeat(512 * 1024);
    for (let i = 0; i < 34; i++) {
      await t.run(async (ctx) => {
        await ctx.db.insert("comments", {
          resourceRef: "big",
          authorRef: "legacy",
          body,
          status: "open",
          createdAt: i,
          updatedAt: i,
        });
      });
    }
    const { commentId } = await t.mutation(api.mutations.post, { resourceRef: "big", authorRef: "a", body: "new" });
    await t.mutation(api.mutations.remove, { commentId, authorRef: "a" });
    const legacyId = await t.run(async (ctx) => (await ctx.db.query("comments").first())?._id);
    if (legacyId === undefined) throw new Error("missing fixture");
    await t.mutation(api.mutations.remove, { commentId: legacyId, authorRef: "legacy" });
    expect(await t.run((ctx) => ctx.db.query("resourceCounts").collect())).toEqual([]);
  });
});
