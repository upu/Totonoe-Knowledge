import assert from "node:assert/strict";
import test from "node:test";
import { validateKnowledgeDocuments, type ValidationDocument } from "./knowledgeValidator";

function entry(id: string, overrides = ""): string {
  return `---
id: ${id}
title: "Title"
summary: "Summary"
type: investigation
status: active
applies_from: ""
applies_to: ""
keywords: []
created_at: 2026-07-15T00:00:00.000Z
updated_at: 2026-07-15T00:00:00.000Z
related: []
supersedes: []
${overrides}---
# 結論
# 背景
# 確認したこと
# 対応方法
# 注意点
# 未解決事項
# 元情報
`;
}

test("accepts a valid repository", () => {
  assert.deepEqual(validateKnowledgeDocuments([{ path: "one.md", content: entry("K-20260715-001") }]), []);
});

test("detects missing metadata, invalid type, and malformed dates", () => {
  const content = entry("K-20260715-001")
    .replace("title: \"Title\"\n", "")
    .replace("type: investigation", "type: memo")
    .replace("created_at: 2026-07-15T00:00:00.000Z", "created_at: not-a-date");
  const codes = validateKnowledgeDocuments([{ path: "bad.md", content }]).map((value) => value.code);
  assert.ok(codes.includes("missing-field"));
  assert.ok(codes.includes("invalid-type"));
  assert.ok(codes.includes("invalid-date"));
});

test("detects duplicate IDs, self references, unknown references, and duplicate references", () => {
  const documents: ValidationDocument[] = [
    {
      path: "one.md",
      content: entry("K-20260715-001")
        .replace("related: []", "related:\n  - K-20260715-001\n  - K-20260715-999\n  - K-20260715-999"),
    },
    { path: "two.md", content: entry("K-20260715-001") },
  ];
  const codes = validateKnowledgeDocuments(documents).map((value) => value.code);
  assert.equal(codes.filter((code) => code === "duplicate-id").length, 2);
  assert.ok(codes.includes("self-reference"));
  assert.ok(codes.includes("unknown-reference"));
  assert.ok(codes.includes("duplicate-reference"));
});

test("warns when a fixed heading is absent", () => {
  const issues = validateKnowledgeDocuments([
    { path: "one.md", content: entry("K-20260715-001").replace("# 注意点\n", "") },
  ]);
  assert.ok(issues.some((value) => value.code === "missing-heading" && value.message.includes("注意点")));
});

test("detects a supersedes cycle", () => {
  const first = entry("K-20260715-001").replace(
    "supersedes: []",
    "supersedes:\n  - K-20260715-002",
  );
  const second = entry("K-20260715-002").replace(
    "supersedes: []",
    "supersedes:\n  - K-20260715-001",
  );
  const issues = validateKnowledgeDocuments([
    { path: "one.md", content: first },
    { path: "two.md", content: second },
  ]);
  assert.equal(issues.filter((value) => value.code === "supersedes-cycle").length, 2);
});

test("treats an unknown supersedes target as an integrity error", () => {
  const content = entry("K-20260715-001").replace(
    "supersedes: []",
    "supersedes:\n  - K-20260715-999",
  );
  const issue = validateKnowledgeDocuments([{ path: "one.md", content }])
    .find((value) => value.code === "unknown-reference");
  assert.equal(issue?.severity, "error");
  assert.match(issue?.message ?? "", /supersedes/);
});

test("accepts comparable inclusive version ranges and legacy entries without bounds", () => {
  const ranged = entry("K-20260715-001")
    .replace('applies_from: ""', 'applies_from: "RHEL9.1"')
    .replace('applies_to: ""', 'applies_to: "RHEL9.4"');
  const legacy = entry("K-20260715-002")
    .replace('applies_from: ""\n', "")
    .replace('applies_to: ""\n', "");
  assert.deepEqual(validateKnowledgeDocuments([
    { path: "ranged.md", content: ranged },
    { path: "legacy.md", content: legacy },
  ]), []);
});

test("rejects malformed, incompatible, and reversed version ranges", () => {
  const malformed = entry("K-20260715-001")
    .replace('applies_from: ""', 'applies_from: "rolling"');
  const incompatible = entry("K-20260715-002")
    .replace('applies_from: ""', 'applies_from: "RHEL9"')
    .replace('applies_to: ""', 'applies_to: "Ubuntu10"');
  const reversed = entry("K-20260715-003")
    .replace('applies_from: ""', 'applies_from: "17.2"')
    .replace('applies_to: ""', 'applies_to: "17.1"');
  const codes = validateKnowledgeDocuments([
    { path: "malformed.md", content: malformed },
    { path: "incompatible.md", content: incompatible },
    { path: "reversed.md", content: reversed },
  ]).map((value) => value.code);
  assert.ok(codes.includes("invalid-version"));
  assert.ok(codes.includes("incompatible-version-range"));
  assert.ok(codes.includes("reversed-version-range"));
});
