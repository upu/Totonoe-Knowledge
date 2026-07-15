import assert from "node:assert/strict";
import test from "node:test";
import { parsePreparedKnowledgeSource } from "./preparedKnowledgeSource";

const prepared = `---
prepared_knowledge: "1"
title: "Markdownを正本にする"
summary: "検索DBは再生成可能な派生物として扱う"
type: decision
keywords:
  - "Markdown"
  - "SQLite"
---

# 結論

Markdownを正本にする。

# 背景

DBがなくても読める必要がある。

# 確認したこと

- Gitで差分をreviewできる
- indexを再生成できる

# 対応方法

EntryをMarkdownで保存する。

# 注意点

- indexも機密情報として扱う

# 未解決事項

- なし

# 参照

- Issue #1
`;

test("parses a versioned prepared source without a language model", () => {
  assert.deepEqual(parsePreparedKnowledgeSource(prepared), {
    title: "Markdownを正本にする",
    summary: "検索DBは再生成可能な派生物として扱う",
    type: "decision",
    keywords: ["Markdown", "SQLite"],
    content: {
      conclusion: "Markdownを正本にする。",
      background: "DBがなくても読める必要がある。",
      verified: ["Gitで差分をreviewできる", "indexを再生成できる"],
      procedure: "EntryをMarkdownで保存する。",
      cautions: ["indexも機密情報として扱う"],
      unresolved: ["なし"],
    },
  });
});

test("ignores ordinary Markdown and rejects malformed prepared sources", () => {
  assert.equal(parsePreparedKnowledgeSource("# 普通の調査メモ"), undefined);
  assert.throws(
    () => parsePreparedKnowledgeSource(prepared.replace("type: decision", "type: unknown")),
    /typeはinvestigation, troubleshooting, specification, change, procedure, decision/,
  );
  assert.throws(
    () => parsePreparedKnowledgeSource(prepared.replace("# 注意点", "# 備考")),
    /見出しが不足しています: 注意点/,
  );
  assert.throws(
    () => parsePreparedKnowledgeSource(prepared.replace('prepared_knowledge: "1"', 'prepared_knowledge: "2"')),
    /prepared_knowledgeは"1"/,
  );
  assert.throws(
    () => parsePreparedKnowledgeSource(`${prepared}\n# 結論\n重複`),
    /見出しが重複しています: 結論/,
  );
  assert.throws(
    () => parsePreparedKnowledgeSource(prepared.replace("Markdownを正本にする。", "")),
    /結論に本文が必要です/,
  );
});
