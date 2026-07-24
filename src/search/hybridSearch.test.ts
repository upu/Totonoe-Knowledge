import assert from "node:assert/strict";
import test from "node:test";
import {
  parseKnowledgeDocument,
  rankHybridKnowledgeDocuments,
  searchKnowledgeDocuments,
} from "./searchEngine";

function document(path: string, title: string, summary: string, keywords: string[] = []) {
  return parseKnowledgeDocument({
    path,
    content: `---
id: ${path}
title: "${title}"
summary: "${summary}"
type: decision
status: active
keywords:
${keywords.map((keyword) => `  - "${keyword}"`).join("\n")}
---
# Conclusion
${summary}`,
  });
}

test("semantic evidence finds a paraphrase that lexical-only search misses", () => {
  const target = document("approval.md", "Human approval gate", "Promote a draft only after a person accepts it");
  const distractor = document("logging.md", "Application logging", "Collect diagnostic output");
  const query = "AI must not store conversations automatically";
  assert.deepEqual(searchKnowledgeDocuments([target, distractor], query), []);

  const results = rankHybridKnowledgeDocuments([target, distractor], query, new Map([
    [target.path, { similarity: 0.88, provider: "fake:model" }],
    [distractor.path, { similarity: 0.12, provider: "fake:model" }],
  ]));
  assert.equal(results[0]?.path, target.path);
  assert.equal(results[0]?.scoreBreakdown.embeddingProvider, "fake:model");
  assert.ok(results[0]?.scoreBreakdown.reasons.some((reason) => reason.includes("0.8800")));
});

test("an exact error code remains ahead of a semantic distractor", () => {
  const exact = document("exact.md", "ERR-123 recovery", "Restart the failed worker", ["ERR-123"]);
  const distractor = document("semantic.md", "Worker troubleshooting", "Diagnose a failed background process");
  const results = rankHybridKnowledgeDocuments([exact, distractor], "ERR-123", new Map([
    [exact.path, { similarity: 0.55, provider: "fake:model" }],
    [distractor.path, { similarity: 0.99, provider: "fake:model" }],
  ]));
  assert.equal(results[0]?.path, exact.path);
  assert.ok(results[0]?.scoreBreakdown.reasons.some((reason) => reason.includes("bonus")));
});

test("metadata and semantic contributions are visible in score reasons", () => {
  const target = document("decision.md", "Storage choice", "Keep the source in Markdown", ["architecture"]);
  const distractor = document("logging.md", "Application logging", "Collect diagnostic output");
  const result = rankHybridKnowledgeDocuments([target, distractor], "architecture", new Map([
    [target.path, { similarity: 0.75, provider: "fake:model" }],
    [distractor.path, { similarity: 0.25, provider: "fake:model" }],
  ]))[0];
  assert.ok(result.scoreBreakdown.metadata > 0);
  assert.ok(result.scoreBreakdown.semantic > 0);
  assert.ok(result.scoreBreakdown.reasons.length >= 3);
  assert.ok(result.scoreBreakdown.reasons.some((reason) => reason.includes("分布confidence=")));
});

test("an explicitly configured absolute floor still filters weaker semantic evidence", () => {
  const target = document("approval.md", "Human approval gate", "Promote a draft after review");
  const results = rankHybridKnowledgeDocuments([target], "担当者が認めてから採用", new Map([
    [target.path, { similarity: 0.3839, provider: "fake:model" }],
  ]), { minimumSemanticSimilarity: 0.45 });
  assert.deepEqual(results, []);
});

test("a narrow leading margin does not receive the full semantic weight", () => {
  const documents = [
    document("first.md", "First candidate", "Unrelated candidate one"),
    document("second.md", "Second candidate", "Unrelated candidate two"),
    document("third.md", "Third candidate", "Unrelated candidate three"),
    document("fourth.md", "Fourth candidate", "Unrelated candidate four"),
  ];
  const results = rankHybridKnowledgeDocuments(documents, "承認済みの提案だけを確定する", new Map([
    [documents[0].path, { similarity: 0.3215, provider: "fake:model" }],
    [documents[1].path, { similarity: 0.3175, provider: "fake:model" }],
    [documents[2].path, { similarity: 0.2400, provider: "fake:model" }],
    [documents[3].path, { similarity: 0.1565, provider: "fake:model" }],
  ]));
  assert.ok(results[0].scoreBreakdown.semantic > 0);
  assert.ok(results[0].scoreBreakdown.semantic < 5);
  assert.ok(results[0].scoreBreakdown.reasons.some((reason) =>
    reason.includes("上位margin=0.0040/範囲=0.1650"),
  ));
});
