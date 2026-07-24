import { frontmatterList, parseFrontmatter } from "../knowledge/frontmatter";
import type { ProposedDocumentUpdate } from "../knowledge/documentUpdate";
import type { KnowledgeDraft } from "../knowledge/types";
import type {
  RelationCandidate,
  RelationKind,
  RelationSuggestion,
} from "./relationCandidates";

export type { ProposedDocumentUpdate } from "../knowledge/documentUpdate";

export type RelationDecision =
  | { id: string; action: "reject" }
  | { id: string; action: "accept"; relation: RelationKind };

export type RelationApprovalPlan =
  | {
      status: "continue";
      draft: KnowledgeDraft;
      updates: ProposedDocumentUpdate[];
    }
  | {
      status: "duplicate";
      candidate: RelationCandidate;
    };

function lineEnding(content: string): "\r\n" | "\n" {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

function replaceFrontmatterField(
  content: string,
  key: string,
  replacement: string[],
): string {
  const ending = lineEnding(content);
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error("front matterがないため変更案を作成できません。");
  const lines = match[1].split(/\r?\n/);
  const keyIndex = lines.findIndex((line) =>
    new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:`).test(line)
  );
  if (keyIndex >= 0) {
    let end = keyIndex + 1;
    while (end < lines.length && /^\s+-\s+/.test(lines[end])) end += 1;
    lines.splice(keyIndex, end - keyIndex, ...replacement);
  } else {
    lines.push(...replacement);
  }
  const frontmatter = `---${ending}${lines.join(ending)}${ending}---${ending}`;
  return frontmatter + content.slice(match[0].length);
}

export function updateFrontmatterList(
  content: string,
  key: string,
  additions: readonly string[],
): string {
  const parsed = parseFrontmatter(content);
  if (!parsed.hasFrontmatter) throw new Error("front matterがないため関係を更新できません。");
  const current = frontmatterList(parsed, key);
  if (Object.hasOwn(parsed.values, key) && current === undefined) {
    throw new Error(`${key}が文字列配列ではないため関係を更新できません。`);
  }
  return setFrontmatterList(content, key, [
    ...(current ?? []),
    ...additions,
  ]);
}

export function setFrontmatterList(
  content: string,
  key: string,
  requestedValues: readonly string[],
): string {
  const parsed = parseFrontmatter(content);
  if (!parsed.hasFrontmatter) throw new Error("front matterがないため関係を更新できません。");
  if (Object.hasOwn(parsed.values, key) && frontmatterList(parsed, key) === undefined) {
    throw new Error(`${key}が文字列配列ではないため関係を更新できません。`);
  }
  const values = [...new Set(requestedValues.map((value) => value.trim()).filter(Boolean))];
  const replacement = values.length
    ? [`${key}:`, ...values.map((value) => `  - ${JSON.stringify(value)}`)]
    : [`${key}: []`];
  const updated = replaceFrontmatterField(content, key, replacement);
  return updated === content ? content : updated;
}

function updateFrontmatterString(content: string, key: string, value: string): string {
  return replaceFrontmatterField(content, key, [`${key}: ${JSON.stringify(value)}`]);
}

function appendUnique(values: string[] | undefined, value: string): string[] {
  return [...new Set([...(values ?? []), value])];
}

export function buildRelationApprovalPlan(
  draft: KnowledgeDraft,
  candidates: readonly RelationCandidate[],
  suggestions: readonly RelationSuggestion[],
  decisions: readonly RelationDecision[],
  additionalUpdates: readonly ProposedDocumentUpdate[] = [],
): RelationApprovalPlan {
  const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const suggestionIds = new Set(suggestions.map((suggestion) => suggestion.id));
  const accepted = decisions.filter(
    (decision): decision is Extract<RelationDecision, { action: "accept" }> =>
      decision.action === "accept",
  );
  for (const decision of decisions) {
    if (!suggestionIds.has(decision.id) || !candidatesById.has(decision.id)) {
      throw new Error(`未提示の候補を承認しようとしました: ${decision.id}`);
    }
  }
  const duplicate = accepted.find((decision) => decision.relation === "Duplicate");
  if (duplicate) {
    return { status: "duplicate", candidate: candidatesById.get(duplicate.id)! };
  }

  let related = [...(draft.relatedKnowledgeIds ?? [])];
  let supersedes = [...(draft.supersedesKnowledgeIds ?? [])];
  let conflicts = [...(draft.conflictKnowledgeIds ?? [])];
  const updates = new Map(additionalUpdates.map((update) => [update.path, { ...update }]));

  for (const decision of accepted) {
    const candidate = candidatesById.get(decision.id)!;
    switch (decision.relation) {
      case "Related":
      case "Complement":
        related = appendUnique(related, candidate.id);
        break;
      case "Supersede":
        supersedes = appendUnique(supersedes, candidate.id);
        break;
      case "Conflict": {
        conflicts = appendUnique(conflicts, candidate.id);
        const existing = updates.get(candidate.path);
        const expectedContent = existing?.expectedContent ?? candidate.content;
        if (expectedContent !== candidate.content) {
          throw new Error(`候補取得後に更新案の基準が変わっています: ${candidate.path}`);
        }
        const basedOn = existing?.proposedContent ?? candidate.content;
        const withConflict = updateFrontmatterList(basedOn, "conflicts", [draft.id]);
        updates.set(candidate.path, {
          path: candidate.path,
          expectedContent,
          proposedContent: updateFrontmatterString(withConflict, "updated_at", draft.createdAt),
          reason: [existing?.reason, `Conflict: ${draft.id}`].filter(Boolean).join(" / "),
        });
        break;
      }
      case "Duplicate":
        break;
    }
  }

  return {
    status: "continue",
    draft: {
      ...draft,
      relatedKnowledgeIds: related,
      supersedesKnowledgeIds: supersedes,
      conflictKnowledgeIds: conflicts,
    },
    updates: [...updates.values()],
  };
}
