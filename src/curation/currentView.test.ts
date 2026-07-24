import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCurrentViewDraft,
  buildCurrentViewSourceUpdates,
  findCurrentViewLinks,
  type CurrentViewSource,
} from "./currentView";

function source(
  id: string,
  options: Partial<CurrentViewSource> = {},
): CurrentViewSource {
  return {
    id,
    title: `${id} title`,
    summary: `${id} summary`,
    type: "change",
    keywords: ["Current View"],
    path: `changes/${id}.md`,
    updatedAt: "2026-07-20T00:00:00.000Z",
    content: `---
id: ${id}
title: "${id} title"
summary: "${id} summary"
type: change
status: active
keywords: []
created_at: 2026-07-20T00:00:00.000Z
updated_at: 2026-07-20T00:00:00.000Z
related: []
supersedes: []
conflicts: []
affects:
  - "K-CURRENT"
---
# 結論
source body`,
    ...options,
  };
}

const generated = {
  title: "Current View",
  summary: "現在仕様をまとめる",
  keywords: ["Current View", "承認"],
  content: {
    conclusion: "現在仕様",
    background: "粒ナレッジから再生成した。",
    verified: ["sourceを確認"],
    procedure: "承認後に反映する。",
    cautions: [],
    unresolved: [],
  },
};

test("builds a specification Current View draft with selected source tracking", () => {
  const sources = [source("K-001"), source("K-002")];
  const draft = buildCurrentViewDraft(
    generated,
    sources,
    new Date("2026-07-25T00:00:00.000Z"),
    {
      id: "K-CURRENT",
      createdAt: "2026-07-01T00:00:00.000Z",
      appliesFrom: "1.2.0",
      appliesTo: "1.x",
    },
  );

  assert.equal(draft.id, "K-CURRENT");
  assert.equal(draft.createdAt, "2026-07-01T00:00:00.000Z");
  assert.equal(draft.appliesFrom, "1.2.0");
  assert.equal(draft.appliesTo, "1.x");
  assert.equal(draft.type, "specification");
  assert.deepEqual(draft.consolidatedKnowledgeIds, ["K-001", "K-002"]);
  assert.equal(draft.consolidatedAt, "2026-07-25T00:00:00.000Z");
  assert.match(draft.source, /K-001/);
});

test("removes resolved affects references without overwriting source bodies", () => {
  const sources = [source("K-001"), source("K-002", {
    content: source("K-002").content.replace(
      '  - "K-CURRENT"',
      '  - "K-CURRENT"\n  - "K-OTHER"',
    ),
  })];
  const updates = buildCurrentViewSourceUpdates(sources, "K-CURRENT");

  assert.equal(updates.length, 2);
  assert.doesNotMatch(updates[0].proposedContent, /K-CURRENT/);
  assert.match(updates[1].proposedContent, /K-OTHER/);
  for (const [index, update] of updates.entries()) {
    assert.equal(
      update.proposedContent.slice(update.proposedContent.indexOf("# 結論")),
      sources[index].content.slice(sources[index].content.indexOf("# 結論")),
    );
  }
});

test("finds Current View sources and reverse links from granular Entries", () => {
  const granular = source("K-001");
  const current = source("K-CURRENT", {
    type: "specification",
    content: source("K-CURRENT").content.replace(
      'affects:\n  - "K-CURRENT"',
      'affects: []\nconsolidates:\n  - "K-001"\nconsolidated_at: "2026-07-25T00:00:00.000Z"',
    ),
  });

  assert.deepEqual(
    findCurrentViewLinks([granular, current], "K-CURRENT").sources.map((entry) => entry.id),
    ["K-001"],
  );
  assert.deepEqual(
    findCurrentViewLinks([granular, current], "K-001").currentViews.map((entry) => entry.id),
    ["K-CURRENT"],
  );
});
