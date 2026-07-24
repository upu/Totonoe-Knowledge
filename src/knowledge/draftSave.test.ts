import assert from "node:assert/strict";
import test from "node:test";
import { persistDraft, persistDraftTransaction } from "./draftSave";

test("saves the latest draft when the target is still free", async () => {
  let saves = 0;
  const result = await persistDraft({
    targetExists: async () => false,
    save: async () => { saves += 1; return true; },
  });
  assert.deepEqual(result, { status: "saved" });
  assert.equal(saves, 1);
});

test("does not overwrite a target created after preview", async () => {
  let saves = 0;
  const result = await persistDraft({
    targetExists: async () => true,
    save: async () => { saves += 1; return true; },
  });
  assert.deepEqual(result, { status: "conflict" });
  assert.equal(saves, 0);
});

test("treats an exclusive-save collision as a conflict", async () => {
  const result = await persistDraft({
    targetExists: async () => false,
    save: async () => "conflict",
  });
  assert.deepEqual(result, { status: "conflict" });
});

test("reports a false or rejected editor save as a failure", async () => {
  assert.deepEqual(
    await persistDraft({ targetExists: async () => false, save: async () => false }),
    { status: "failed" },
  );
  const failure = new Error("disk full");
  assert.deepEqual(
    await persistDraft({ targetExists: async () => false, save: async () => { throw failure; } }),
    { status: "failed", error: failure },
  );
});

test("applies existing document updates only after the new draft saves", async () => {
  const events: string[] = [];
  let current = "before";
  const result = await persistDraftTransaction({
    targetExists: async () => false,
    save: async () => {
      events.push("save-new");
      return true;
    },
    rollbackNew: async () => {
      events.push("rollback-new");
    },
    updates: [{
      expectedContent: "before",
      proposedContent: "after",
      read: async () => current,
      write: async (content) => {
        events.push(`write:${content}`);
        current = content;
      },
    }],
  });

  assert.deepEqual(result, { status: "saved" });
  assert.deepEqual(events, ["save-new", "write:after"]);
  assert.equal(current, "after");
});

test("does not save or update when an approved existing document became stale", async () => {
  let saveCalls = 0;
  let writeCalls = 0;
  const result = await persistDraftTransaction({
    targetExists: async () => false,
    save: async () => {
      saveCalls += 1;
      return true;
    },
    rollbackNew: async () => undefined,
    updates: [{
      expectedContent: "previewed",
      proposedContent: "approved",
      read: async () => "changed elsewhere",
      write: async () => {
        writeCalls += 1;
      },
    }],
  });

  assert.equal(result.status, "conflict");
  assert.equal(saveCalls, 0);
  assert.equal(writeCalls, 0);
});

test("rolls back the new draft and already applied updates when a later update fails", async () => {
  const events: string[] = [];
  let first = "before-1";
  let second = "before-2";
  const failure = new Error("write failed");
  const result = await persistDraftTransaction({
    targetExists: async () => false,
    save: async () => {
      events.push("save-new");
      return true;
    },
    rollbackNew: async () => {
      events.push("rollback-new");
    },
    updates: [
      {
        expectedContent: "before-1",
        proposedContent: "after-1",
        read: async () => first,
        write: async (content) => {
          events.push(`write-1:${content}`);
          first = content;
        },
      },
      {
        expectedContent: "before-2",
        proposedContent: "after-2",
        read: async () => second,
        write: async (content) => {
          events.push(`write-2:${content}`);
          if (content === "after-2") throw failure;
          second = content;
        },
      },
    ],
  });

  assert.equal(result.status, "failed");
  assert.equal(first, "before-1");
  assert.equal(second, "before-2");
  assert.deepEqual(events, [
    "save-new",
    "write-1:after-1",
    "write-2:after-2",
    "write-2:before-2",
    "write-1:before-1",
    "rollback-new",
  ]);
});
