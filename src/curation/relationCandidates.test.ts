import assert from "node:assert/strict";
import test from "node:test";
import type { KnowledgeDraft } from "../knowledge/types";
import type { KnowledgeSearchResult } from "../search/searchEngine";
import {
  classifyRelationCandidates,
  relationKinds,
  selectRelationCandidates,
  type RelationClassifier,
} from "./relationCandidates";

function draft(overrides: Partial<KnowledgeDraft> = {}): KnowledgeDraft {
  return {
    id: "K-20260725-001",
    title: "承認付きCurrent View",
    summary: "粒ナレッジから現在仕様を生成する",
    type: "specification",
    keywords: ["Current View", "承認"],
    source: "issue #55",
    createdAt: "2026-07-25T00:00:00.000Z",
    content: {
      conclusion: "Current Viewは承認後だけ更新する。",
      background: "",
      verified: [],
      procedure: "",
      cautions: [],
      unresolved: [],
    },
    appliesFrom: "v0.4",
    appliesTo: "v0.9",
    ...overrides,
  };
}

function result(
  id: string,
  title: string,
  score: number,
  overrides: Partial<KnowledgeSearchResult> = {},
): KnowledgeSearchResult {
  return {
    id,
    title,
    summary: `${title}の要約`,
    type: "change",
    status: "active",
    appliesFrom: "v1.0",
    appliesTo: "v1.9",
    supersedes: [],
    keywords: ["別機能"],
    body: "# 結論\n別の内容",
    path: `changes/${id}.md`,
    content: `---
id: ${id}
title: "${title}"
type: change
consolidates: []
---
# 結論
別の内容`,
    score,
    matchedTerms: [],
    scoreBreakdown: {
      fullText: score,
      metadata: 0,
      semantic: 0,
      reasons: [`全文=${score.toFixed(2)}`],
    },
    ...overrides,
  };
}

test("narrows search results using type, version, keywords, search score, and Current View metadata", () => {
  const structurallyRelevant = result("K-002", "承認フロー", 18, {
    type: "specification",
    appliesFrom: "v0.3",
    appliesTo: "v0.5",
    keywords: ["承認", "差分"],
  });
  const currentView = result("K-003", "既存Current View", 10, {
    type: "specification",
    appliesFrom: "v0.4",
    appliesTo: "",
    keywords: ["Current View"],
    content: `---
id: K-003
title: "既存Current View"
type: specification
consolidates:
  - K-001
---
# 結論
現在仕様`,
  });
  const lexicalOnly = result("K-001", "語句だけ一致", 30);

  const candidates = selectRelationCandidates(
    draft(),
    [lexicalOnly, currentView, structurallyRelevant],
    2,
  );

  assert.deepEqual(candidates.map((candidate) => candidate.id), ["K-002", "K-003"]);
  assert.equal(candidates[1].isCurrentView, true);
  assert.ok(candidates[0].selectionReasons.some((reason) => reason.includes("type")));
  assert.ok(candidates[0].selectionReasons.some((reason) => reason.includes("version")));
  assert.ok(candidates[0].selectionReasons.some((reason) => reason.includes("keyword")));
  assert.ok(candidates[0].selectionReasons.some((reason) => reason.includes("search")));
});

test("does not boost incompatible version families and ignores entries without an evidence ID", () => {
  const incompatible = result("K-RHEL", "別製品", 10, {
    type: "specification",
    appliesFrom: "RHEL9.0",
    appliesTo: "RHEL9.9",
    keywords: ["承認"],
  });
  const invalid = result("unknown", "IDなし", 100, {
    type: "specification",
    keywords: ["承認"],
  });

  const candidates = selectRelationCandidates(draft(), [invalid, incompatible], 3);

  assert.deepEqual(candidates.map((candidate) => candidate.id), ["K-RHEL"]);
  assert.equal(candidates[0].selectionReasons.some((reason) => reason.includes("version")), false);
});

test("preserves all five relation kinds with a reason and evidence identity", async () => {
  const candidates = selectRelationCandidates(
    draft(),
    relationKinds.map((kind, index) => result(
      `K-00${index + 1}`,
      `${kind}候補`,
      20 - index,
      {
        type: "specification",
        appliesFrom: "v0.4",
        appliesTo: "v0.8",
        keywords: ["承認"],
      },
    )),
    5,
  );
  const classifier: RelationClassifier = {
    async classify(_draft, values) {
      return values.map((candidate, index) => ({
        id: candidate.id,
        relation: relationKinds[index],
        reason: `${relationKinds[index]}と判断した根拠`,
      }));
    },
  };

  const outcome = await classifyRelationCandidates(draft(), candidates, classifier);

  assert.equal(outcome.status, "suggestions");
  if (outcome.status !== "suggestions") return;
  assert.deepEqual(outcome.suggestions.map((suggestion) => suggestion.relation), relationKinds);
  for (const suggestion of outcome.suggestions) {
    assert.match(suggestion.reason, /根拠/);
    assert.match(suggestion.evidence.id, /^K-/);
    assert.match(suggestion.evidence.title, /候補/);
  }
});

test("does not manufacture relations when a Language Model is unavailable", async () => {
  const candidates = selectRelationCandidates(draft(), [result("K-001", "候補", 10)], 3);
  const outcome = await classifyRelationCandidates(draft(), candidates);

  assert.deepEqual(outcome, {
    status: "unavailable",
    reason: "Language Modelを利用できません。",
  });
});

test("falls back without suggestions when classification fails", async () => {
  const candidates = selectRelationCandidates(draft(), [result("K-001", "候補", 10)], 3);
  const classifier: RelationClassifier = {
    async classify() {
      throw new Error("provider unavailable");
    },
  };

  const outcome = await classifyRelationCandidates(draft(), candidates, classifier);

  assert.equal(outcome.status, "unavailable");
  if (outcome.status === "unavailable") assert.match(outcome.reason, /provider unavailable/);
});

test("skips classification when narrowing found no candidates", async () => {
  let called = false;
  const classifier: RelationClassifier = {
    async classify() {
      called = true;
      return [];
    },
  };

  const outcome = await classifyRelationCandidates(draft(), [], classifier);

  assert.deepEqual(outcome, { status: "none" });
  assert.equal(called, false);
});
