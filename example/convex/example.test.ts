import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { register } from "../../src/test";
import crons, { PRUNE_BATCH, PRUNE_INTERVAL } from "../../src/component/crons";

const modules = import.meta.glob("./**/*.ts");

function setup() {
  const t = convexTest(schema, modules);
  register(t); // default "comments" mount
  register(t, "annotations"); // second named mount — proves mount-safety
  return t;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("comments — happy path (post → list → count)", () => {
  test("post a top-level comment, then read it back", async () => {
    const t = setup();
    const { commentId } = await t.mutation(api.example.post, {
      resourceRef: "post:1",
      authorRef: "user:7",
      body: "hello",
    });
    const c = await t.query(api.example.get, { commentId });
    expect(c?.resourceRef).toBe("post:1");
    expect(c?.authorRef).toBe("user:7");
    expect(c?.body).toBe("hello");
    expect(c?.status).toBe("open");
    expect(c?.parentId).toBeUndefined();
    expect(c?.editedAt).toBeUndefined();
    expect(c?.createdAt).toBe(0);
    expect(c?.updatedAt).toBe(0);
  });

  test("threaded reply links to its parent and pages under it", async () => {
    const t = setup();
    const { commentId: parent } = await t.mutation(api.example.post, {
      resourceRef: "post:1",
      authorRef: "user:7",
      body: "top",
    });
    vi.setSystemTime(10);
    const { commentId: reply } = await t.mutation(api.example.post, {
      resourceRef: "post:1",
      authorRef: "user:9",
      body: "reply",
      parentId: parent,
    });
    const r = await t.query(api.example.get, { commentId: reply });
    expect(r?.parentId).toBe(parent);

    // top level pages only the parent (not the reply)
    const top = await t.query(api.example.list, {
      resourceRef: "post:1",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(top.page.map((c) => c.commentId)).toEqual([parent]);

    // the reply pages under its parent
    const replies = await t.query(api.example.list, {
      resourceRef: "post:1",
      parentId: parent,
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(replies.page.map((c) => c.commentId)).toEqual([reply]);
  });

  test("list returns the resource's comments oldest first", async () => {
    const t = setup();
    await t.mutation(api.example.post, {
      resourceRef: "r",
      authorRef: "u",
      body: "a",
    });
    vi.setSystemTime(10);
    await t.mutation(api.example.post, {
      resourceRef: "r",
      authorRef: "u",
      body: "b",
    });
    vi.setSystemTime(20);
    await t.mutation(api.example.post, {
      resourceRef: "r",
      authorRef: "u",
      body: "c",
    });
    const page = await t.query(api.example.list, {
      resourceRef: "r",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(page.page.map((c) => c.body)).toEqual(["a", "b", "c"]);
    expect(page.isDone).toBe(true);
  });

  test("list respects page size and returns a continue cursor", async () => {
    const t = setup();
    for (let i = 0; i < 3; i++) {
      vi.setSystemTime(i);
      await t.mutation(api.example.post, {
        resourceRef: "r",
        authorRef: "u",
        body: `c${i}`,
      });
    }
    const first = await t.query(api.example.list, {
      resourceRef: "r",
      paginationOpts: { cursor: null, numItems: 2 },
    });
    expect(first.page).toHaveLength(2);
    expect(first.isDone).toBe(false);
    const second = await t.query(api.example.list, {
      resourceRef: "r",
      paginationOpts: { cursor: first.continueCursor, numItems: 2 },
    });
    expect(second.page).toHaveLength(1);
    expect(second.isDone).toBe(true);
  });

  test("count tallies only the visible comments", async () => {
    const t = setup();
    expect(await t.query(api.example.count, { resourceRef: "r" })).toBe(0);
    await t.mutation(api.example.post, {
      resourceRef: "r",
      authorRef: "u",
      body: "a",
    });
    await t.mutation(api.example.post, {
      resourceRef: "r",
      authorRef: "u",
      body: "b",
    });
    expect(await t.query(api.example.count, { resourceRef: "r" })).toBe(2);
  });

  test("list on an empty resource returns an empty done page", async () => {
    const t = setup();
    const r = await t.query(api.example.list, {
      resourceRef: "nobody",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(r.page).toEqual([]);
    expect(r.isDone).toBe(true);
    expect(await t.query(api.example.count, { resourceRef: "nobody" })).toBe(0);
  });
});

describe("comments — edit / resolve", () => {
  test("the author edits the body and records editedAt", async () => {
    const t = setup();
    const { commentId } = await t.mutation(api.example.post, {
      resourceRef: "r",
      authorRef: "u",
      body: "first",
    });
    vi.setSystemTime(1_000);
    await t.mutation(api.example.edit, {
      commentId,
      authorRef: "u",
      body: "second",
    });
    const c = await t.query(api.example.get, { commentId });
    expect(c?.body).toBe("second");
    expect(c?.editedAt).toBe(1_000);
    expect(c?.updatedAt).toBe(1_000);
  });

  test("resolve toggles open → resolved → open (author only)", async () => {
    const t = setup();
    const { commentId } = await t.mutation(api.example.post, {
      resourceRef: "r",
      authorRef: "u",
      body: "x",
    });
    await t.mutation(api.example.resolve, { commentId, authorRef: "u" });
    expect((await t.query(api.example.get, { commentId }))?.status).toBe(
      "resolved",
    );
    // resolved comments are not counted
    expect(await t.query(api.example.count, { resourceRef: "r" })).toBe(1);
    await t.mutation(api.example.resolve, {
      commentId,
      authorRef: "u",
      resolved: false,
    });
    expect((await t.query(api.example.get, { commentId }))?.status).toBe("open");
  });

  test("resolve to the same state is an idempotent no-op", async () => {
    const t = setup();
    const { commentId } = await t.mutation(api.example.post, {
      resourceRef: "r",
      authorRef: "u",
      body: "x",
    });
    vi.setSystemTime(500);
    // already open → resolved:false is a no-op (updatedAt does not advance)
    await t.mutation(api.example.resolve, {
      commentId,
      authorRef: "u",
      resolved: false,
    });
    expect((await t.query(api.example.get, { commentId }))?.updatedAt).toBe(0);
  });
});

describe("comments — soft delete", () => {
  test("delete hides the comment, clears its body, and preserves replies", async () => {
    const t = setup();
    const { commentId: parent } = await t.mutation(api.example.post, {
      resourceRef: "r",
      authorRef: "u",
      body: "top",
    });
    const { commentId: reply } = await t.mutation(api.example.post, {
      resourceRef: "r",
      authorRef: "u2",
      body: "reply",
      parentId: parent,
    });
    await t.mutation(api.example.remove, { commentId: parent, authorRef: "u" });

    const deleted = await t.query(api.example.get, { commentId: parent });
    expect(deleted?.status).toBe("deleted");
    expect(deleted?.body).toBeUndefined();
    // the reply row survives
    expect(
      (await t.query(api.example.get, { commentId: reply }))?.body,
    ).toBe("reply");
    // a default list excludes the deleted parent
    const visible = await t.query(api.example.list, {
      resourceRef: "r",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(visible.page.map((c) => c.commentId)).toEqual([]);
    // includeDeleted surfaces it
    const all = await t.query(api.example.list, {
      resourceRef: "r",
      includeDeleted: true,
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(all.page.map((c) => c.commentId)).toEqual([parent]);
    // the still-open reply remains visible — only the deleted parent dropped out
    expect(await t.query(api.example.count, { resourceRef: "r" })).toBe(1);
  });

  test("re-deleting an already-deleted comment is a no-op", async () => {
    const t = setup();
    const { commentId } = await t.mutation(api.example.post, {
      resourceRef: "r",
      authorRef: "u",
      body: "x",
    });
    await t.mutation(api.example.remove, { commentId, authorRef: "u" });
    vi.setSystemTime(999);
    await t.mutation(api.example.remove, { commentId, authorRef: "u" });
    // second remove returned early — updatedAt unchanged from the first delete
    expect((await t.query(api.example.get, { commentId }))?.updatedAt).toBe(0);
  });
});

describe("comments — adversarial (auth + lifecycle)", () => {
  test("get on a missing id returns null", async () => {
    const t = setup();
    const ghost = await t.mutation(api.example.post, {
      resourceRef: "r",
      authorRef: "u",
      body: "x",
    });
    await t.mutation(api.example.remove, {
      commentId: ghost.commentId,
      authorRef: "u",
    });
    await t.mutation(api.example.prune, { before: 1, batch: 200 });
    expect(
      await t.query(api.example.get, { commentId: ghost.commentId }),
    ).toBeNull();
  });

  test("edit by a non-author is rejected", async () => {
    const t = setup();
    const { commentId } = await t.mutation(api.example.post, {
      resourceRef: "r",
      authorRef: "owner",
      body: "mine",
    });
    await expect(
      t.mutation(api.example.edit, {
        commentId,
        authorRef: "intruder",
        body: "hacked",
      }),
    ).rejects.toThrow(/only the author/);
    expect((await t.query(api.example.get, { commentId }))?.body).toBe("mine");
  });

  test("delete by a non-author is rejected", async () => {
    const t = setup();
    const { commentId } = await t.mutation(api.example.post, {
      resourceRef: "r",
      authorRef: "owner",
      body: "mine",
    });
    await expect(
      t.mutation(api.example.remove, { commentId, authorRef: "intruder" }),
    ).rejects.toThrow(/only the author/);
    expect((await t.query(api.example.get, { commentId }))?.status).toBe("open");
  });

  test("resolve by a non-author is rejected", async () => {
    const t = setup();
    const { commentId } = await t.mutation(api.example.post, {
      resourceRef: "r",
      authorRef: "owner",
      body: "mine",
    });
    await expect(
      t.mutation(api.example.resolve, { commentId, authorRef: "intruder" }),
    ).rejects.toThrow(/only the author/);
  });

  test("editing a deleted comment is rejected", async () => {
    const t = setup();
    const { commentId } = await t.mutation(api.example.post, {
      resourceRef: "r",
      authorRef: "u",
      body: "x",
    });
    await t.mutation(api.example.remove, { commentId, authorRef: "u" });
    await expect(
      t.mutation(api.example.edit, { commentId, authorRef: "u", body: "y" }),
    ).rejects.toThrow(/deleted and cannot be edited/);
  });

  test("resolving a deleted comment is rejected", async () => {
    const t = setup();
    const { commentId } = await t.mutation(api.example.post, {
      resourceRef: "r",
      authorRef: "u",
      body: "x",
    });
    await t.mutation(api.example.remove, { commentId, authorRef: "u" });
    await expect(
      t.mutation(api.example.resolve, { commentId, authorRef: "u" }),
    ).rejects.toThrow(/deleted and cannot be resolved/);
  });

  test("edit / delete / resolve / get on a missing id throw NOT_FOUND", async () => {
    const t = setup();
    // create then hard-prune a comment to obtain a real-but-absent id
    const { commentId } = await t.mutation(api.example.post, {
      resourceRef: "r",
      authorRef: "u",
      body: "x",
    });
    await t.mutation(api.example.remove, { commentId, authorRef: "u" });
    await t.mutation(api.example.prune, { before: 1, batch: 200 });

    await expect(
      t.mutation(api.example.edit, { commentId, authorRef: "u", body: "y" }),
    ).rejects.toThrow(/not found/);
    await expect(
      t.mutation(api.example.remove, { commentId, authorRef: "u" }),
    ).rejects.toThrow(/not found/);
    await expect(
      t.mutation(api.example.resolve, { commentId, authorRef: "u" }),
    ).rejects.toThrow(/not found/);
    expect(await t.query(api.example.get, { commentId })).toBeNull();
  });

  test("replying to a missing parent is rejected", async () => {
    const t = setup();
    const { commentId } = await t.mutation(api.example.post, {
      resourceRef: "r",
      authorRef: "u",
      body: "x",
    });
    await t.mutation(api.example.remove, { commentId, authorRef: "u" });
    await t.mutation(api.example.prune, { before: 1, batch: 200 });
    await expect(
      t.mutation(api.example.post, {
        resourceRef: "r",
        authorRef: "u",
        body: "reply",
        parentId: commentId,
      }),
    ).rejects.toThrow(/parent comment .* not found/);
  });

  test("replying with a parent on a different resource is rejected", async () => {
    const t = setup();
    const { commentId: parent } = await t.mutation(api.example.post, {
      resourceRef: "post:1",
      authorRef: "u",
      body: "top",
    });
    await expect(
      t.mutation(api.example.post, {
        resourceRef: "post:2",
        authorRef: "u",
        body: "reply",
        parentId: parent,
      }),
    ).rejects.toThrow(/different resource/);
  });

  test("replying under a deleted parent is rejected", async () => {
    const t = setup();
    const { commentId: parent } = await t.mutation(api.example.post, {
      resourceRef: "r",
      authorRef: "u",
      body: "top",
    });
    await t.mutation(api.example.remove, { commentId: parent, authorRef: "u" });
    await expect(
      t.mutation(api.example.post, {
        resourceRef: "r",
        authorRef: "u",
        body: "reply",
        parentId: parent,
      }),
    ).rejects.toThrow(/cannot reply under a deleted comment/);
  });
});

describe("comments — host body validator (strict client)", () => {
  test("a valid body round-trips through the strict client", async () => {
    const t = setup();
    const { commentId } = await t.mutation(api.example.postStrict, {
      resourceRef: "r",
      authorRef: "u",
      body: "ok",
    });
    expect((await t.query(api.example.getStrict, { commentId }))?.body).toBe(
      "ok",
    );
    await t.mutation(api.example.editStrict, {
      commentId,
      authorRef: "u",
      body: "edited",
    });
    expect((await t.query(api.example.getStrict, { commentId }))?.body).toBe(
      "edited",
    );
  });

  test("a body failing the host validator is rejected before storage", async () => {
    const t = setup();
    await expect(
      t.mutation(api.example.postStrict, {
        resourceRef: "r",
        authorRef: "u",
        body: "",
      }),
    ).rejects.toThrow(/invalid body/);
    expect(await t.query(api.example.count, { resourceRef: "r" })).toBe(0);
  });

  test("an edit failing the host validator is rejected before storage", async () => {
    const t = setup();
    const { commentId } = await t.mutation(api.example.postStrict, {
      resourceRef: "r",
      authorRef: "u",
      body: "good",
    });
    await expect(
      t.mutation(api.example.editStrict, {
        commentId,
        authorRef: "u",
        body: 123,
      }),
    ).rejects.toThrow(/invalid body/);
    expect((await t.query(api.example.getStrict, { commentId }))?.body).toBe(
      "good",
    );
  });
});

describe("comments — mount-safety (independent named mount)", () => {
  test("the same resource in two mounts is independent", async () => {
    const t = setup();
    await t.mutation(api.example.post, {
      resourceRef: "shared",
      authorRef: "u",
      body: "main",
    });
    await t.mutation(api.example.postAnnotation, {
      resourceRef: "shared",
      authorRef: "u",
      body: "annotation",
    });
    expect(await t.query(api.example.count, { resourceRef: "shared" })).toBe(1);
    expect(
      await t.query(api.example.countAnnotations, { resourceRef: "shared" }),
    ).toBe(1);
    expect(await t.mutation(api.example.pruneAnnotations, {})).toBe(0);
  });
});

describe("comments — prune (bounded + self-rescheduling)", () => {
  test("prunes only deleted comments past the cutoff", async () => {
    const t = setup();
    // deleted + old
    const a = await t.mutation(api.example.post, {
      resourceRef: "r",
      authorRef: "u",
      body: "a",
    });
    await t.mutation(api.example.remove, {
      commentId: a.commentId,
      authorRef: "u",
    });
    // open (never pruned) + a fresh delete after the cutoff
    const b = await t.mutation(api.example.post, {
      resourceRef: "r",
      authorRef: "u",
      body: "b",
    });
    vi.setSystemTime(1_000);
    const c = await t.mutation(api.example.post, {
      resourceRef: "r",
      authorRef: "u",
      body: "c",
    });
    await t.mutation(api.example.remove, {
      commentId: c.commentId,
      authorRef: "u",
    });

    const removed = await t.mutation(api.example.prune, {
      before: 100,
      batch: 200,
    });
    expect(removed).toBe(1);
    expect(
      await t.query(api.example.get, { commentId: a.commentId }),
    ).toBeNull();
    expect(
      await t.query(api.example.get, { commentId: b.commentId }),
    ).not.toBeNull();
    expect(
      await t.query(api.example.get, { commentId: c.commentId }),
    ).not.toBeNull();
  });

  test("prune with no cutoff honors the default retention window", async () => {
    const t = setup();
    const { commentId } = await t.mutation(api.example.post, {
      resourceRef: "r",
      authorRef: "u",
      body: "x",
    });
    await t.mutation(api.example.remove, { commentId, authorRef: "u" });

    vi.setSystemTime(30 * 24 * 60 * 60 * 1_000);
    expect(await t.mutation(api.example.prune, {})).toBe(0);
    expect(await t.query(api.example.get, { commentId })).not.toBeNull();

    vi.setSystemTime(30 * 24 * 60 * 60 * 1_000 + 1);
    expect(await t.mutation(api.example.prune, {})).toBe(1);
    expect(await t.query(api.example.get, { commentId })).toBeNull();
  });

  test("preserves a deleted parent tombstone while any reply exists", async () => {
    const t = setup();
    const parent = await t.mutation(api.example.post, {
      resourceRef: "r",
      authorRef: "u",
      body: "parent",
    });
    const reply = await t.mutation(api.example.post, {
      resourceRef: "r",
      authorRef: "v",
      body: "reply",
      parentId: parent.commentId,
    });
    await t.mutation(api.example.remove, {
      commentId: parent.commentId,
      authorRef: "u",
    });

    vi.setSystemTime(1_000);
    expect(
      await t.mutation(api.example.prune, { before: 1_000, batch: 1 }),
    ).toBe(0);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.query(api.example.get, { commentId: parent.commentId })).not.toBeNull();
    expect(await t.query(api.example.get, { commentId: reply.commentId })).not.toBeNull();
  });

  test("rejects a non-finite cutoff", async () => {
    const t = setup();
    await expect(
      t.mutation(api.example.prune, { before: Number.NaN, batch: 1 }),
    ).rejects.toThrow("before must be finite");
  });

  test.each([Number.NaN, 0, -1, 1.5, 501])("rejects invalid batch %s", async (batch) => {
    const t = setup();
    await expect(
      t.mutation(api.example.prune, { before: 1_000, batch }),
    ).rejects.toThrow("batch must be an integer between 1 and 500");
  });

  test("prune on an empty table returns 0", async () => {
    const t = setup();
    expect(
      await t.mutation(api.example.prune, { before: 9_999_999, batch: 200 }),
    ).toBe(0);
  });

  test("prune above the batch size self-reschedules and clears the whole tail", async () => {
    const t = setup();
    for (let i = 0; i < 5; i++) {
      const { commentId } = await t.mutation(api.example.post, {
        resourceRef: "r",
        authorRef: "u",
        body: `c${i}`,
      });
      await t.mutation(api.example.remove, { commentId, authorRef: "u" });
    }
    vi.setSystemTime(1_000);
    const firstPass = await t.mutation(api.example.prune, {
      before: 1_000,
      batch: 2,
    });
    expect(firstPass).toBe(2);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const all = await t.query(api.example.list, {
      resourceRef: "r",
      includeDeleted: true,
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(all.page).toEqual([]);
  });
});

describe("comments — built-in prune cron", () => {
  test("registers a daily self-rescheduling prune job with the default page size", () => {
    expect(PRUNE_INTERVAL).toEqual({ hours: 24 });
    expect(PRUNE_BATCH).toBe(200);
    expect(Object.keys(crons.crons)).toContain("comments:prune");
    const job = crons.crons["comments:prune"];
    expect(job?.name).toBe("mutations:prune");
    expect(job?.args).toEqual([{ batch: 200 }]);
  });
});

describe("comments — host/component table isolation", () => {
  test("a host resource lives in the host table, separate from the component", async () => {
    const t = setup();
    await t.mutation(api.example.post, {
      resourceRef: "post:1",
      authorRef: "u",
      body: "x",
    });
    await t.mutation(api.example.addResource, {
      resourceRef: "post:1",
      title: "My Post",
    });
    // the host resource is readable from the host table
    expect(
      await t.query(api.example.getResourceTitle, { resourceRef: "post:1" }),
    ).toBe("My Post");
    // the component comment is unaffected
    expect(await t.query(api.example.count, { resourceRef: "post:1" })).toBe(1);
    // a resource with no comments is fine — fully decoupled
    await t.mutation(api.example.addResource, {
      resourceRef: "post:2",
      title: "Empty",
    });
    expect(
      await t.query(api.example.getResourceTitle, { resourceRef: "post:2" }),
    ).toBe("Empty");
    expect(await t.query(api.example.count, { resourceRef: "post:2" })).toBe(0);
  });
});
