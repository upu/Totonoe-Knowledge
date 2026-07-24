import assert from "node:assert/strict";
import test from "node:test";
import { persistDraft } from "./draftSave";

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
