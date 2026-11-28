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

describe("comments component — ref length limit", () => {
  const atLimit = "x".repeat(MAX_REF_LENGTH);
  const overLimit = "x".repeat(MAX_REF_LENGTH + 1);
  const emojiAtLimit = "😀".repeat(MAX_REF_LENGTH / 2);
  const emojiOverLimit = `${emojiAtLimit}x`;
  const fields = ["resourceRef", "authorRef"] as const;

  async function insertOverLong(t: ReturnType<typeof setup>, resourceRef: string, authorRef: string) {
    return t.run((ctx) =>
      ctx.db.insert("comments", { resourceRef, authorRef, body: "old", status: "open", createdAt: 0, updatedAt: 0 }),
    );
  }

  test.each(fields)("post accepts a %s of exactly MAX_REF_LENGTH code units", async (field) => {
    const t = setup();
    for (const ref of [atLimit, emojiAtLimit]) {
      expect(ref).toHaveLength(MAX_REF_LENGTH);
      const result = await t.mutation(api.mutations.post, { resourceRef: "doc", authorRef: "a", body: "b", [field]: ref });
      expect(await t.query(api.queries.get, { commentId: result.commentId })).toMatchObject({ [field]: ref });
    }
  });

  test.each(fields)("post rejects a new %s one code unit over the limit with INVALID_REF", async (field) => {
    const t = setup();
    for (const ref of [overLimit, emojiOverLimit]) {
      expect(ref).toHaveLength(MAX_REF_LENGTH + 1);
      await expect(
        t.mutation(api.mutations.post, { resourceRef: "doc", authorRef: "a", body: "b", [field]: ref }),
      ).rejects.toMatchObject({ data: { code: "INVALID_REF" } });
    }
    expect(await t.run((ctx) => ctx.db.query("comments").collect())).toEqual([]);
  });

  test("the limit counts UTF-16 code units: 257 emoji are 514 units and are rejected", async () => {
    const t = setup();
    const emoji = "😀".repeat(MAX_REF_LENGTH / 2 + 1);
    expect([...emoji]).toHaveLength(MAX_REF_LENGTH / 2 + 1);
    await expect(
      t.mutation(api.mutations.post, { resourceRef: emoji, authorRef: "a", body: "b" }),
    ).rejects.toMatchObject({ data: { code: "INVALID_REF" } });
  });

  test("an over-long resource that already has comments stays readable and open to new posts", async () => {
    const t = setup();
    const legacyId = await insertOverLong(t, overLimit, "legacy");
    expect(await t.query(api.queries.get, { commentId: legacyId })).toMatchObject({ resourceRef: overLimit });
    expect(await t.query(api.queries.count, { resourceRef: overLimit })).toBe(1);
    const { commentId } = await t.mutation(api.mutations.post, { resourceRef: overLimit, authorRef: "a", body: "new" });
    await t.mutation(api.mutations.post, { resourceRef: overLimit, authorRef: "b", body: "reply", parentId: legacyId });
    const page = await t.query(api.queries.list, {
      resourceRef: overLimit,
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(page.page.map((c) => c.commentId)).toEqual([legacyId, commentId]);
    expect(await t.query(api.queries.count, { resourceRef: overLimit })).toBe(3);
  });

  test("an over-long author that already has comments can keep posting, on any resource", async () => {
    const t = setup();
    await insertOverLong(t, "doc", overLimit);
    const { commentId } = await t.mutation(api.mutations.post, { resourceRef: "other", authorRef: overLimit, body: "new" });
    expect(await t.query(api.queries.get, { commentId })).toMatchObject({ authorRef: overLimit, resourceRef: "other" });
  });

  test("grandfathering is per ref: a known over-long resource does not admit a new over-long author", async () => {
    const t = setup();
    await insertOverLong(t, overLimit, "legacy");
    await expect(
      t.mutation(api.mutations.post, { resourceRef: overLimit, authorRef: `${overLimit}y`, body: "b" }),
    ).rejects.toMatchObject({ data: { code: "INVALID_REF" } });
  });

  test("an over-long ref counts as new again once all its comments are pruned", async () => {
    const t = setup();
    const id = await insertOverLong(t, overLimit, "legacy");
    await t.run((ctx) => ctx.db.patch("comments", id, { status: "deleted", body: undefined }));
    const { commentId } = await t.mutation(api.mutations.post, { resourceRef: overLimit, authorRef: "a", body: "b" });
    await t.mutation(api.mutations.remove, { commentId, authorRef: "a" });
    await t.mutation(api.mutations.prune, { before: Date.now() + 1, batch: 10 });
    expect(await t.run((ctx) => ctx.db.query("comments").collect())).toEqual([]);
    await expect(
      t.mutation(api.mutations.post, { resourceRef: overLimit, authorRef: "a", body: "b" }),
    ).rejects.toMatchObject({ data: { code: "INVALID_REF" } });
  });

  test("edit, resolve and remove keep working on a row with over-long refs and leave the refs unchanged", async () => {
    const t = setup();
    const id = await insertOverLong(t, overLimit, overLimit);
    await t.mutation(api.mutations.edit, { commentId: id, authorRef: overLimit, body: "edited" });
    await t.mutation(api.mutations.resolve, { commentId: id, authorRef: overLimit, resolved: true });
    expect(await t.query(api.queries.get, { commentId: id })).toMatchObject({
      resourceRef: overLimit,
      authorRef: overLimit,
      body: "edited",
      status: "resolved",
    });
    await t.mutation(api.mutations.remove, { commentId: id, authorRef: overLimit });
    expect(await t.query(api.queries.get, { commentId: id })).toMatchObject({
      resourceRef: overLimit,
      authorRef: overLimit,
      status: "deleted",
    });
    expect(await t.query(api.queries.count, { resourceRef: overLimit })).toBe(0);
  });
});
