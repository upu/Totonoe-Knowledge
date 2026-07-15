import assert from "node:assert/strict";
import test from "node:test";
import { decodeRepositorySelection } from "./repositorySelection";

test("decodes versioned local and remote repository selections", () => {
  assert.deepEqual(
    decodeRepositorySelection({ version: 1, uri: "file:///C:/knowledge%20base" }),
    { version: 1, uri: "file:///C:/knowledge%20base" },
  );
  assert.deepEqual(
    decodeRepositorySelection({ version: 1, uri: "vscode-remote://ssh-remote%2Bhost/home/user/knowledge" }),
    { version: 1, uri: "vscode-remote://ssh-remote%2Bhost/home/user/knowledge" },
  );
});

test("rejects malformed, relative, and unknown selection state", () => {
  for (const value of [
    undefined,
    "file:///C:/knowledge",
    { version: 2, uri: "file:///C:/knowledge" },
    { version: 1, uri: "../knowledge" },
    { version: 1, uri: "not a uri" },
  ]) {
    assert.equal(decodeRepositorySelection(value), undefined);
  }
});
