import { frontmatterList, frontmatterString, parseFrontmatter } from "../knowledge/frontmatter";
import { knowledgeTypes, type KnowledgeType } from "../knowledge/types";
import { compareVersionStrings, parseComparableVersion } from "../knowledge/versioning";

export interface ValidationDocument {
  path: string;
  content: string;
}

export interface KnowledgeValidationIssue {
  path: string;
  line: number;
  severity: "error" | "warning";
  code: string;
  message: string;
}

interface ValidatedEntry {
  path: string;
  id?: string;
  type?: string;
  updatedAt?: string;
  related: string[];
  supersedes: string[];
  conflicts: string[];
  affects: string[];
  consolidates: string[];
  consolidatedAt?: string;
  keyLines: Record<string, number>;
}

const requiredStringFields = ["id", "title", "summary", "type", "status", "created_at", "updated_at"];
const requiredHeadings = ["# 結論", "# 背景", "# 確認したこと", "# 対応方法", "# 注意点", "# 未解決事項", "# 元情報"];
const knowledgeStatuses = new Set(["draft", "active", "deprecated", "archived"]);

function issue(
  document: ValidationDocument,
  line: number,
  severity: KnowledgeValidationIssue["severity"],
  code: string,
  message: string,
): KnowledgeValidationIssue {
  return { path: document.path, line, severity, code, message };
}

function referenceLine(content: string, id: string, fallback: number): number {
  const lines = content.split(/\r?\n/);
  const found = lines.findIndex((line) => line.includes(id));
  return found >= 0 ? found : fallback;
}

export function validateKnowledgeDocuments(
  documents: ValidationDocument[],
): KnowledgeValidationIssue[] {
  const issues: KnowledgeValidationIssue[] = [];
  const entries: ValidatedEntry[] = [];
  const idOwners = new Map<string, ValidatedEntry[]>();

  for (const document of documents) {
    const parsed = parseFrontmatter(document.content);
    if (!parsed.hasFrontmatter) {
      issues.push(issue(document, 0, "error", "missing-frontmatter", "Markdown front matterがありません。"));
      entries.push({
        path: document.path,
        related: [],
        supersedes: [],
        conflicts: [],
        affects: [],
        consolidates: [],
        keyLines: {},
      });
      continue;
    }

    for (const duplicate of parsed.duplicateKeys) {
      issues.push(issue(
        document,
        duplicate.line,
        "error",
        "duplicate-key",
        `front matterの ${duplicate.key} が重複しています。`,
      ));
    }

    for (const field of requiredStringFields) {
      const value = frontmatterString(parsed, field);
      if (value === undefined) {
        issues.push(issue(
          document,
          parsed.keyLines[field] ?? 1,
          "error",
          "missing-field",
          `必須フィールド ${field} がないか、文字列ではありません。`,
        ));
      } else if (!value.trim() && field !== "summary") {
        issues.push(issue(document, parsed.keyLines[field], "error", "empty-field", `${field} が空です。`));
      }
    }

    for (const field of ["keywords", "related", "supersedes"]) {
      if (frontmatterList(parsed, field) === undefined) {
        issues.push(issue(
          document,
          parsed.keyLines[field] ?? 1,
          "error",
          "invalid-list",
          `${field} は文字列配列で指定してください。`,
        ));
      }
    }
    for (const field of ["conflicts", "affects", "consolidates"]) {
      if (
        Object.hasOwn(parsed.values, field)
        && frontmatterList(parsed, field) === undefined
      ) {
        issues.push(issue(
          document,
          parsed.keyLines[field] ?? 1,
          "error",
          "invalid-list",
          `${field} は文字列配列で指定してください。`,
        ));
      }
    }

    const type = frontmatterString(parsed, "type");
    if (type && !knowledgeTypes.includes(type as KnowledgeType)) {
      issues.push(issue(document, parsed.keyLines.type, "error", "invalid-type", `未対応のtypeです: ${type}`));
    }
    const status = frontmatterString(parsed, "status");
    if (status && !knowledgeStatuses.has(status)) {
      issues.push(issue(document, parsed.keyLines.status, "error", "invalid-status", `未対応のstatusです: ${status}`));
    }
    if (frontmatterString(parsed, "summary") === "") {
      issues.push(issue(document, parsed.keyLines.summary, "warning", "empty-summary", "summaryが空です。"));
    }
    for (const field of ["created_at", "updated_at"]) {
      const value = frontmatterString(parsed, field);
      if (value && Number.isNaN(Date.parse(value))) {
        issues.push(issue(document, parsed.keyLines[field], "error", "invalid-date", `${field} が日時として解釈できません。`));
      }
    }

    const versionValues = new Map<string, string>();
    for (const field of ["applies_from", "applies_to"]) {
      if (!Object.hasOwn(parsed.values, field)) continue;
      const value = frontmatterString(parsed, field);
      if (value === undefined) {
        issues.push(issue(
          document,
          parsed.keyLines[field] ?? 1,
          "error",
          "invalid-version",
          `${field} は文字列で指定してください。`,
        ));
        continue;
      }
      if (value.trim() && !parseComparableVersion(value)) {
        issues.push(issue(
          document,
          parsed.keyLines[field],
          "error",
          "invalid-version",
          `${field} は比較可能な版表記ではありません: ${value}`,
        ));
        continue;
      }
      versionValues.set(field, value.trim());
    }
    const appliesFrom = versionValues.get("applies_from");
    const appliesTo = versionValues.get("applies_to");
    if (appliesFrom && appliesTo) {
      const comparison = compareVersionStrings(appliesFrom, appliesTo);
      if (comparison === undefined) {
        issues.push(issue(
          document,
          parsed.keyLines.applies_to ?? 1,
          "error",
          "incompatible-version-range",
          `applies_fromとapplies_toの製品系列が一致しません: ${appliesFrom} / ${appliesTo}`,
        ));
      } else if (comparison > 0) {
        issues.push(issue(
          document,
          parsed.keyLines.applies_to ?? 1,
          "error",
          "reversed-version-range",
          `applies_fromがapplies_toより後です: ${appliesFrom} / ${appliesTo}`,
        ));
      }
    }

    const id = frontmatterString(parsed, "id")?.trim();
    if (id && !/^K-\d{8}-[A-Za-z0-9-]+$/.test(id)) {
      issues.push(issue(document, parsed.keyLines.id, "warning", "nonstandard-id", `標準形式ではないIDです: ${id}`));
    }
    const consolidates = frontmatterList(parsed, "consolidates") ?? [];
    const consolidatedAt = frontmatterString(parsed, "consolidated_at")?.trim();
    const isCurrentView = consolidates.length > 0 || Boolean(consolidatedAt);
    if (
      isCurrentView
      && (
        type !== "specification"
        || !consolidates.length
        || !consolidatedAt
        || Number.isNaN(Date.parse(consolidatedAt))
      )
    ) {
      issues.push(issue(
        document,
        parsed.keyLines.consolidated_at ?? parsed.keyLines.consolidates ?? 1,
        "error",
        "invalid-current-view",
        "Current Viewにはtype: specification、1件以上のconsolidates、有効なconsolidated_atが必要です。",
      ));
    }
    const entry: ValidatedEntry = {
      path: document.path,
      id,
      type,
      updatedAt: frontmatterString(parsed, "updated_at")?.trim(),
      related: frontmatterList(parsed, "related") ?? [],
      supersedes: frontmatterList(parsed, "supersedes") ?? [],
      conflicts: frontmatterList(parsed, "conflicts") ?? [],
      affects: frontmatterList(parsed, "affects") ?? [],
      consolidates,
      consolidatedAt,
      keyLines: parsed.keyLines,
    };
    entries.push(entry);
    if (id) idOwners.set(id, [...(idOwners.get(id) ?? []), entry]);

    for (const heading of requiredHeadings) {
      if (!parsed.body.split(/\r?\n/).some((line) => line.trim() === heading)) {
        issues.push(issue(document, 0, "warning", "missing-heading", `固定見出し「${heading}」がありません。`));
      }
    }
  }

  for (const [id, owners] of idOwners) {
    if (owners.length < 2) continue;
    for (const owner of owners) {
      const document = documents.find((candidate) => candidate.path === owner.path)!;
      issues.push(issue(document, owner.keyLines.id ?? 1, "error", "duplicate-id", `Knowledge ID ${id} が重複しています。`));
    }
  }

  const knownIds = new Set(idOwners.keys());
  for (const entry of entries) {
    const document = documents.find((candidate) => candidate.path === entry.path)!;
    for (const [field, references] of [
      ["related", entry.related],
      ["supersedes", entry.supersedes],
      ["conflicts", entry.conflicts],
      ["affects", entry.affects],
      ["consolidates", entry.consolidates],
    ] as const) {
      for (const reference of new Set(references)) {
        const line = referenceLine(document.content, reference, entry.keyLines[field] ?? 1);
        if (reference === entry.id) {
          issues.push(issue(document, line, "error", "self-reference", `${field} が自分自身 ${reference} を参照しています。`));
        } else if (!knownIds.has(reference)) {
          issues.push(issue(
            document,
            line,
            field === "supersedes" || field === "affects" || field === "consolidates"
              ? "error"
              : "warning",
            "unknown-reference",
            `${field} の参照先 ${reference} が見つかりません。`,
          ));
        }
      }
      if (new Set(references).size !== references.length) {
        issues.push(issue(document, entry.keyLines[field] ?? 1, "warning", "duplicate-reference", `${field} に重複したIDがあります。`));
      }
    }
  }

  const uniqueEntries = new Map(
    entries.filter((entry) => entry.id && idOwners.get(entry.id)?.length === 1).map((entry) => [entry.id!, entry]),
  );
  const reaches = (target: string, current: string, visited: Set<string>): boolean => {
    if (current === target) return true;
    if (visited.has(current)) return false;
    visited.add(current);
    return (uniqueEntries.get(current)?.supersedes ?? [])
      .some((next) => reaches(target, next, visited));
  };
  for (const entry of uniqueEntries.values()) {
    if (!entry.id || !entry.supersedes.some((reference) => reaches(entry.id!, reference, new Set()))) continue;
    const document = documents.find((candidate) => candidate.path === entry.path)!;
    issues.push(issue(
      document,
      entry.keyLines.supersedes ?? 1,
      "error",
      "supersedes-cycle",
      `supersedes関係が循環しています: ${entry.id}`,
    ));
  }

  for (const currentView of uniqueEntries.values()) {
    if (!currentView.id || !currentView.consolidates.length || !currentView.consolidatedAt) continue;
    const currentDocument = documents.find((candidate) => candidate.path === currentView.path)!;
    const consolidatedTime = Date.parse(currentView.consolidatedAt);
    if (Number.isNaN(consolidatedTime)) continue;
    for (const sourceId of currentView.consolidates) {
      const source = uniqueEntries.get(sourceId);
      if (source?.updatedAt && Date.parse(source.updatedAt) > consolidatedTime) {
        issues.push(issue(
          currentDocument,
          currentView.keyLines.consolidated_at ?? 1,
          "warning",
          "stale-current-view",
          `根拠Entry ${sourceId} がconsolidated_atより後に更新されています。`,
        ));
      }
      const replacement = [...uniqueEntries.values()].find((entry) =>
        entry.id
        && !currentView.consolidates.includes(entry.id)
        && entry.supersedes.includes(sourceId)
      );
      if (replacement?.id) {
        issues.push(issue(
          currentDocument,
          currentView.keyLines.consolidates ?? 1,
          "warning",
          "stale-current-view",
          `根拠Entry ${sourceId} が未包含Entry ${replacement.id} に置き換えられています。`,
        ));
      }
    }
    for (const pending of uniqueEntries.values()) {
      if (!pending.id || !pending.affects.includes(currentView.id)) continue;
      issues.push(issue(
        currentDocument,
        currentView.keyLines.consolidates ?? 1,
        "warning",
        "stale-current-view",
        `Entry ${pending.id} のaffectsがこのCurrent Viewへの未反映変更を示しています。`,
      ));
    }
  }

  return issues.sort((a, b) =>
    a.path.localeCompare(b.path) || a.line - b.line || a.code.localeCompare(b.code),
  );
}
