import type { KnowledgeDraft, KnowledgeType } from "./types";

const typeDirectories: Record<KnowledgeType, string> = {
  investigation: "investigations",
  troubleshooting: "troubleshooting",
  specification: "specifications",
  change: "changes",
  procedure: "procedures",
  decision: "decisions",
};

export function directoryFor(type: KnowledgeType): string {
  return typeDirectories[type];
}

export function slugify(value: string): string {
  const slug = value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "knowledge";
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

export function renderKnowledge(draft: KnowledgeDraft): string {
  const keywords = draft.keywords.length
    ? draft.keywords.map((keyword) => `  - ${yamlString(keyword)}`).join("\n")
    : "  []";

  return `---
id: ${draft.id}
title: ${yamlString(draft.title)}
summary: ${yamlString(draft.summary)}
type: ${draft.type}
status: active
keywords:
${keywords}
created_at: ${draft.createdAt}
updated_at: ${draft.createdAt}
related: []
supersedes: []
---

# 結論

${draft.summary || "ここに結論を記入してください。"}

# 背景

このナレッジを作成した背景を記入してください。

# 確認したこと

- 確認事項を記入してください。

# 対応方法

必要な手順や実装内容を記入してください。

# 注意点

- 適用範囲、前提条件、既知の制約を記入してください。

# 未解決事項

- 未解決事項がなければ「なし」と記入してください。

# 元情報

<!-- 機密情報や認証情報が含まれていないか、保存前に確認してください。 -->

${draft.source}
`;
}

