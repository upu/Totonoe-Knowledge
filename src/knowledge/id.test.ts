import assert from "node:assert/strict";
import test from "node:test";
import { createKnowledgeId } from "./id";

test("creates a sortable ID with injected collision entropy", () => {
  assert.equal(
    createKnowledgeId(new Date("2026-07-15T01:02:03.456Z"), "a1b2"),
    "K-20260715-010203456-a1b2",
  );
});
