import assert from "node:assert/strict";
import test from "node:test";
import { isValidRepositoryPath } from "./repositoryPath";

test("accepts workspace-relative repository paths", () => {
  assert.equal(isValidRepositoryPath("knowledge"), true);
  assert.equal(isValidRepositoryPath("docs/team-knowledge"), true);
  assert.equal(isValidRepositoryPath("docs\\knowledge"), true);
});

test("rejects absolute and escaping paths", () => {
  assert.equal(isValidRepositoryPath(""), false);
  assert.equal(isValidRepositoryPath("../knowledge"), false);
  assert.equal(isValidRepositoryPath("docs/../../knowledge"), false);
  assert.equal(isValidRepositoryPath("/tmp/knowledge"), false);
  assert.equal(isValidRepositoryPath("C:\\knowledge"), false);
});
