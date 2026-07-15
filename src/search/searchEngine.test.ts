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
status: active
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
status: active
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
  assert.equal(parsed.status, "active");
  assert.equal(parsed.summary, "PTYの端末幅をsttyで変更する");
  assert.equal(parsed.appliesFrom, "");
  assert.equal(parsed.appliesTo, "");
  assert.deepEqual(parsed.supersedes, []);
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

test("preserves punctuation-delimited error-code search", () => {
  const errorDocument = {
    path: "knowledge/troubleshooting/K-003.md",
    content: documents[0].content.replace("COLUMNS環境変数", "ERR-123 は COLUMNS環境変数"),
  };
  assert.equal(searchKnowledgeDocuments([errorDocument], "err-123")[0]?.path, errorDocument.path);
});

test("returns no result for an empty or unmatched query", () => {
  assert.deepEqual(searchKnowledgeDocuments(documents, "  "), []);
  assert.deepEqual(searchKnowledgeDocuments(documents, "Kubernetes"), []);
});

test("filters inclusive ranges and removes transitively superseded entries for a target version", () => {
  const versionedDocuments = [
    {
      path: "old.md",
      content: `---
id: K-OLD
title: "Legacy transport setting"
summary: "transport value A"
type: specification
status: active
applies_from: "17.0"
applies_to: ""
keywords: []
supersedes: []
---
# 結論
Use A.`,
    },
    {
      path: "middle.md",
      content: `---
id: K-MIDDLE
title: "Intermediate setting"
summary: "transport value B"
type: change
status: active
applies_from: "17.1"
applies_to: ""
keywords: []
supersedes:
  - K-OLD
---
# 結論
Use B.`,
    },
    {
      path: "current.md",
      content: `---
id: K-CURRENT
title: "Current setting"
summary: "transport value C"
type: change
status: active
applies_from: "17.2"
applies_to: ""
keywords: []
supersedes:
  - K-MIDDLE
---
# 結論
Use C.`,
    },
  ];

  assert.deepEqual(
    searchKnowledgeDocuments(versionedDocuments, "transport", { version: "17.0" }).map((result) => result.id),
    ["K-OLD"],
  );
  assert.deepEqual(
    searchKnowledgeDocuments(versionedDocuments, "transport", { version: "17.1" }).map((result) => result.id),
    ["K-MIDDLE"],
  );
  assert.deepEqual(
    searchKnowledgeDocuments(versionedDocuments, "transport", { version: "17.2" }).map((result) => result.id),
    ["K-CURRENT"],
  );
});

test("rejects a non-comparable target version", () => {
  assert.throws(
    () => searchKnowledgeDocuments(documents, "SSH", { version: "rolling" }),
    /比較できない対象バージョン/,
  );
});
