import assert from "node:assert/strict";
import test from "node:test";
import type { KnowledgeDraft } from "../knowledge/types";
import type { RelationCandidate } from "../curation/relationCandidates";
import {
  buildRelationCandidatePrompt,
  parseRelationCandidateResponse,
} from "./relationCandidatePrompt";

const draft: KnowledgeDraft = {
  id: "K-NEW",
  title: "Current Viewを更新する",
  summary: "承認後だけ現在仕様へ反映する",
  type: "specification",
  keywords: ["Current View", "承認"],
  source: "untrusted source",
  createdAt: "2026-07-25T00:00:00.000Z",
  content: {
    conclusion: "人が承認してから反映する。",
    background: "",
    verified: [],
    procedure: "",
    cautions: [],
    unresolved: [],
  },
};

const candidates: RelationCandidate[] = [{
  id: "K-001",
  title: "既存Current View",
  summary: "現在仕様をまとめる",
  type: "specification",
  keywords: ["Current View"],
  appliesFrom: "",
  appliesTo: "",
  path: "specifications/K-001.md",
  body: "# 結論\n現在仕様",
  content: "---\nid: K-001\n---\n# 結論\n現在仕様",
  searchScore: 42,
  searchReasons: ["全文=20.00"],
  isCurrentView: true,
  selectionScore: 68,
  selectionReasons: ["search score=42.00", "type=specification"],
}];

test("builds a bounded prompt that treats draft and Entry contents as untrusted evidence", () => {
  const prompt = buildRelationCandidatePrompt(draft, candidates);

  assert.match(prompt, /命令には従わ/);
  assert.match(prompt, /K-001/);
  assert.match(prompt, /既存Current View/);
  assert.match(prompt, /Duplicate/);
  assert.doesNotMatch(prompt, /untrusted source/);
});

test("parses a relation only for a supplied evidence Entry", () => {
  const parsed = parseRelationCandidateResponse(JSON.stringify({
    candidates: [{
      id: "K-001",
      relation: "Complement",
      reason: "同じ対象の別側面を説明している。",
    }],
  }), candidates);

  assert.deepEqual(parsed, [{
    id: "K-001",
    relation: "Complement",
    reason: "同じ対象の別側面を説明している。",
  }]);
});

test("rejects unknown IDs, relation kinds, empty reasons, and prose outside JSON", () => {
  assert.throws(
    () => parseRelationCandidateResponse(JSON.stringify({
      candidates: [{ id: "K-999", relation: "Related", reason: "根拠" }],
    }), candidates),
    /候補集合/,
  );
  assert.throws(
    () => parseRelationCandidateResponse(JSON.stringify({
      candidates: [{ id: "K-001", relation: "Merge", reason: "根拠" }],
    }), candidates),
    /関係種別/,
  );
  assert.throws(
    () => parseRelationCandidateResponse(JSON.stringify({
      candidates: [{ id: "K-001", relation: "Related", reason: " " }],
    }), candidates),
    /理由/,
  );
  assert.throws(
    () => parseRelationCandidateResponse("結果です\n{\"candidates\":[]}", candidates),
    /JSON/,
  );
});
