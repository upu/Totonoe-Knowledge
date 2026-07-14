import assert from "node:assert/strict";
import test from "node:test";
import { parseKnowledgeDocument, searchKnowledgeDocuments } from "./searchEngine";

const documents = [
  {
    path: "knowledge/investigations/K-001.md",
    content: `---
title: "SSHログが80文字で折り返される原因"
summary: "PTYの端末幅をsttyで変更する"
id: K-001
type: investigation
keywords:
  - "SSH"
  - "PTY"
  - "stty"
---
# 結論
COLUMNS環境変数だけでは端末幅は変わらない。`,
  },
  {
    path: "knowledge/procedures/K-002.md",
    content: `---
title: "アプリケーションログの収集手順"
summary: "障害調査用のログを収集する"
id: K-002
type: procedure
keywords:
  - "logging"
---
# 手順
SSHでサーバーへ接続する。`,
  },
];

test("parses quoted frontmatter and keyword lists", () => {
  const parsed = parseKnowledgeDocument(documents[0]);
  assert.equal(parsed.title, "SSHログが80文字で折り返される原因");
  assert.equal(parsed.id, "K-001");
  assert.equal(parsed.type, "investigation");
  assert.equal(parsed.summary, "PTYの端末幅をsttyで変更する");
  assert.deepEqual(parsed.keywords, ["SSH", "PTY", "stty"]);
  assert.match(parsed.body, /COLUMNS/);
});

test("weights title, summary, keywords, and body", () => {
  const results = searchKnowledgeDocuments(documents, "SSH PTY");
  assert.equal(results[0].path, documents[0].path);
  assert.deepEqual(results[0].matchedTerms, ["ssh", "pty"]);
  assert.ok(results[0].score > results[1].score);
});

test("normalizes Japanese and latin text case-insensitively", () => {
  const results = searchKnowledgeDocuments(documents, "ｓｔｔｙ 原因");
  assert.equal(results.length, 1);
  assert.equal(results[0].title, "SSHログが80文字で折り返される原因");
});

test("returns no result for an empty or unmatched query", () => {
  assert.deepEqual(searchKnowledgeDocuments(documents, "  "), []);
  assert.deepEqual(searchKnowledgeDocuments(documents, "Kubernetes"), []);
});
