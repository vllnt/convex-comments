/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./component/_generated/api.js";
import schema from "./component/schema.js";
import { MAX_REF_LENGTH } from "./shared.js";

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

  test("legacy resources fall back to a scan, then backfill on the first write", async () => {
    const t = setup();
    await insertLegacy(t, "open");
    await insertLegacy(t, "resolved");
    await insertLegacy(t, "deleted");
    expect(await t.query(api.queries.count, { resourceRef: "doc" })).toBe(2);
    await t.mutation(api.mutations.post, { resourceRef: "doc", authorRef: "a", body: "hi" });
    expect(await t.query(api.queries.count, { resourceRef: "doc" })).toBe(3);
    const counter = await t.run((ctx) => ctx.db.query("resourceCounts").unique());
    expect(counter?.visible).toBe(3);
  });

  test("remove on a legacy resource backfills and decrements once; repeat remove is a no-op", async () => {
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

describe("comments component — ref length limits", () => {
  const long = "x".repeat(MAX_REF_LENGTH + 1);

  test.each(["resourceRef", "authorRef"] as const)("post rejects an over-long %s", async (field) => {
    const t = setup();
    await expect(
      t.mutation(api.mutations.post, { resourceRef: "doc", authorRef: "a", body: "b", [field]: long }),
    ).rejects.toThrow(/INVALID_REF|at most/);
  });

  test("post keeps working for over-long refs that already have comments", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("comments", {
        resourceRef: long,
        authorRef: long,
        body: "legacy",
        status: "open",
        createdAt: 0,
        updatedAt: 0,
      });
    });
    await t.mutation(api.mutations.post, { resourceRef: long, authorRef: long, body: "reply" });
    expect(await t.query(api.queries.count, { resourceRef: long })).toBe(2);
  });

  test("post accepts refs at the limit", async () => {
    const t = setup();
    const ok = "x".repeat(MAX_REF_LENGTH);
    const result = await t.mutation(api.mutations.post, { resourceRef: ok, authorRef: ok, body: "b" });
    expect(result.commentId).toBeTypeOf("string");
  });
});
