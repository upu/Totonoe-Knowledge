import assert from "node:assert/strict";
import test from "node:test";
import type { KnowledgeDraft } from "../knowledge/types";
import type { RelationCandidate, RelationSuggestion } from "./relationCandidates";
import {
  buildRelationApprovalPlan,
  updateFrontmatterList,
  type RelationDecision,
} from "./relationApproval";

function draft(): KnowledgeDraft {
  return {
    id: "K-20260725-NEW",
    title: "新しい仕様",
    summary: "承認後だけ関係を保存する",
    type: "specification",
    keywords: ["承認"],
    source: "issue #56",
    createdAt: "2026-07-25T00:00:00.000Z",
    content: {
      conclusion: "承認境界を設ける。",
      background: "",
      verified: [],
      procedure: "",
      cautions: [],
      unresolved: [],
    },
  };
}

function markdown(id: string, extra = ""): string {
  return `---
id: ${id}
title: "${id}"
summary: "summary"
type: specification
status: active
keywords: []
created_at: 2026-07-25T00:00:00.000Z
updated_at: 2026-07-25T00:00:00.000Z
related: []
supersedes: []
conflicts: []${extra}
---

# 結論

元の本文
`;
}

function candidate(id: string): RelationCandidate {
  const content = markdown(id);
  return {
    id,
    title: id,
    summary: `${id} summary`,
    type: "specification",
    keywords: ["承認"],
    appliesFrom: "",
    appliesTo: "",
    path: `specifications/${id}.md`,
    body: "# 結論\n元の本文",
    content,
    searchScore: 10,
    searchReasons: ["全文=10.00"],
    isCurrentView: false,
    selectionScore: 30,
    selectionReasons: ["search score=10.00"],
  };
}

function suggestion(
  id: string,
  relation: RelationSuggestion["relation"],
): RelationSuggestion {
  return {
    id,
    relation,
    reason: `${relation}の根拠`,
    evidence: {
      id,
      title: id,
      path: `specifications/${id}.md`,
    },
    isCurrentView: false,
  };
}

test("maps accepted and edited relations while leaving rejected candidates untouched", () => {
  const candidates = [
    candidate("K-RELATED"),
    candidate("K-COMPLEMENT"),
    candidate("K-SUPERSEDE"),
    candidate("K-CONFLICT"),
    candidate("K-REJECTED"),
  ];
  const suggestions = [
    suggestion("K-RELATED", "Related"),
    suggestion("K-COMPLEMENT", "Related"),
    suggestion("K-SUPERSEDE", "Supersede"),
    suggestion("K-CONFLICT", "Conflict"),
    suggestion("K-REJECTED", "Conflict"),
  ];
  const decisions: RelationDecision[] = [
    { id: "K-RELATED", action: "accept", relation: "Related" },
    { id: "K-COMPLEMENT", action: "accept", relation: "Complement" },
    { id: "K-SUPERSEDE", action: "accept", relation: "Supersede" },
    { id: "K-CONFLICT", action: "accept", relation: "Conflict" },
    { id: "K-REJECTED", action: "reject" },
  ];

  const plan = buildRelationApprovalPlan(draft(), candidates, suggestions, decisions);

  assert.equal(plan.status, "continue");
  if (plan.status !== "continue") return;
  assert.deepEqual(plan.draft.relatedKnowledgeIds, ["K-RELATED", "K-COMPLEMENT"]);
  assert.deepEqual(plan.draft.supersedesKnowledgeIds, ["K-SUPERSEDE"]);
  assert.deepEqual(plan.draft.conflictKnowledgeIds, ["K-CONFLICT"]);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].path, "specifications/K-CONFLICT.md");
  assert.match(plan.updates[0].proposedContent, /conflicts:\n  - "K-20260725-NEW"/);
  assert.doesNotMatch(plan.updates[0].proposedContent, /K-REJECTED/);
});

test("returns a Duplicate branch without changing either Markdown document", () => {
  const existing = candidate("K-DUPLICATE");
  const plan = buildRelationApprovalPlan(
    draft(),
    [existing],
    [suggestion(existing.id, "Duplicate")],
    [{ id: existing.id, action: "accept", relation: "Duplicate" }],
  );

  assert.deepEqual(plan, {
    status: "duplicate",
    candidate: existing,
  });
});

test("updates an existing front matter list without changing its body", () => {
  const before = markdown("K-EXISTING");
  const after = updateFrontmatterList(before, "conflicts", ["K-NEW"]);

  assert.match(after, /conflicts:\n  - "K-NEW"/);
  assert.equal(after.slice(after.indexOf("# 結論")), before.slice(before.indexOf("# 結論")));
  assert.equal(updateFrontmatterList(after, "conflicts", ["K-NEW"]), after);
});

test("carries a Current View body and front matter proposal unchanged into the approval plan", () => {
  const current = candidate("K-CURRENT");
  const proposed = updateFrontmatterList(
    current.content.replace("元の本文", "再生成した本文"),
    "consolidates",
    ["K-20260725-NEW"],
  );
  const plan = buildRelationApprovalPlan(
    draft(),
    [],
    [],
    [],
    [{
      path: current.path,
      expectedContent: current.content,
      proposedContent: proposed,
      reason: "Current View再生成",
    }],
  );

  assert.equal(plan.status, "continue");
  if (plan.status !== "continue") return;
  assert.deepEqual(plan.updates, [{
    path: current.path,
    expectedContent: current.content,
    proposedContent: proposed,
    reason: "Current View再生成",
  }]);
  assert.match(plan.updates[0].proposedContent, /再生成した本文/);
  assert.match(plan.updates[0].proposedContent, /consolidates:\n  - "K-20260725-NEW"/);
});
