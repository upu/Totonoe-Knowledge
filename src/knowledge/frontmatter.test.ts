import assert from "node:assert/strict";
import test from "node:test";
import { frontmatterList, frontmatterString, parseFrontmatter } from "./frontmatter";

test("parses scalar, block-list, and inline-list frontmatter", () => {
  const parsed = parseFrontmatter(`---
id: K-20260715-001
title: "Quoted title"
keywords:
  - "SSH"
  - PTY
related: ["K-20260714-001"]
---
# Body`);

  assert.equal(parsed.hasFrontmatter, true);
  assert.equal(frontmatterString(parsed, "title"), "Quoted title");
  assert.deepEqual(frontmatterList(parsed, "keywords"), ["SSH", "PTY"]);
  assert.deepEqual(frontmatterList(parsed, "related"), ["K-20260714-001"]);
  assert.equal(parsed.body, "# Body");
  assert.equal(parsed.keyLines.title, 2);
});

test("reports duplicate keys and handles a missing frontmatter block", () => {
  const duplicate = parseFrontmatter("---\nid: K-1\nid: K-2\n---\n");
  assert.deepEqual(duplicate.duplicateKeys, [{ key: "id", line: 2 }]);
  assert.equal(parseFrontmatter("# Plain Markdown").hasFrontmatter, false);
});
