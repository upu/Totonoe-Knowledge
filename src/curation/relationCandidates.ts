import { frontmatterList, parseFrontmatter } from "../knowledge/frontmatter";
import type { KnowledgeDraft } from "../knowledge/types";
import { compareVersionStrings, parseComparableVersion } from "../knowledge/versioning";
import type { KnowledgeSearchResult } from "../search/searchEngine";

export const relationKinds = [
  "Duplicate",
  "Related",
  "Complement",
  "Conflict",
  "Supersede",
] as const;

export type RelationKind = (typeof relationKinds)[number];

export interface RelationCandidate {
  id: string;
  title: string;
  summary: string;
  type: string;
  keywords: string[];
  appliesFrom: string;
  appliesTo: string;
  path: string;
  body: string;
  content: string;
  searchScore: number;
  searchReasons: string[];
  isCurrentView: boolean;
  selectionScore: number;
  selectionReasons: string[];
}

export interface RelationClassification {
  id: string;
  relation: RelationKind;
  reason: string;
}

export interface RelationSuggestion extends RelationClassification {
  evidence: {
    id: string;
    title: string;
    path: string;
  };
  isCurrentView: boolean;
}

export interface RelationClassifier {
  classify(
    draft: KnowledgeDraft,
    candidates: readonly RelationCandidate[],
  ): Promise<readonly RelationClassification[]>;
}

export type RelationSuggestionOutcome =
  | { status: "suggestions"; suggestions: RelationSuggestion[] }
  | { status: "none" }
  | { status: "unavailable"; reason: string };

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().trim();
}

function sharedKeywords(draft: KnowledgeDraft, result: KnowledgeSearchResult): string[] {
  const existing = new Map(result.keywords.map((keyword) => [normalize(keyword), keyword]));
  return [...new Set(draft.keywords
    .map(normalize)
    .filter((keyword) => keyword && existing.has(keyword))
    .map((keyword) => existing.get(keyword)!))];
}

function rangesOverlap(
  leftFrom: string | undefined,
  leftTo: string | undefined,
  rightFrom: string | undefined,
  rightTo: string | undefined,
): boolean {
  const normalizedLeftFrom = leftFrom?.trim();
  const normalizedLeftTo = leftTo?.trim();
  const normalizedRightFrom = rightFrom?.trim();
  const normalizedRightTo = rightTo?.trim();
  const leftBounds = [normalizedLeftFrom, normalizedLeftTo].filter(Boolean) as string[];
  const rightBounds = [normalizedRightFrom, normalizedRightTo].filter(Boolean) as string[];
  const parsedLeftBounds = leftBounds.map(parseComparableVersion);
  const parsedRightBounds = rightBounds.map(parseComparableVersion);
  if (parsedLeftBounds.some((bound) => !bound) || parsedRightBounds.some((bound) => !bound)) {
    return false;
  }
  const leftPrefix = parsedLeftBounds[0]?.prefix;
  const rightPrefix = parsedRightBounds[0]?.prefix;
  if (leftPrefix !== undefined && rightPrefix !== undefined && leftPrefix !== rightPrefix) return false;
  if (normalizedLeftTo && normalizedRightFrom) {
    const comparison = compareVersionStrings(normalizedLeftTo, normalizedRightFrom);
    if (comparison !== undefined && comparison < 0) return false;
  }
  if (normalizedRightTo && normalizedLeftFrom) {
    const comparison = compareVersionStrings(normalizedRightTo, normalizedLeftFrom);
    if (comparison !== undefined && comparison < 0) return false;
  }
  return true;
}

function isCurrentView(result: KnowledgeSearchResult): boolean {
  return (frontmatterList(parseFrontmatter(result.content), "consolidates")?.length ?? 0) > 0;
}

export function relationCandidateQuery(draft: KnowledgeDraft): string {
  return [
    draft.title,
    draft.summary,
    draft.type,
    ...draft.keywords,
  ].filter(Boolean).join(" ");
}

export function selectRelationCandidates(
  draft: KnowledgeDraft,
  results: readonly KnowledgeSearchResult[],
  limit = 3,
): RelationCandidate[] {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error("候補件数は1以上の整数で指定してください。");
  }

  return results.filter((result) =>
    Boolean(result.id)
    && result.id !== "unknown"
    && result.id !== draft.id
  ).map((result) => {
    const matchingKeywords = sharedKeywords(draft, result);
    const sameType = result.type === draft.type;
    const overlappingVersion = rangesOverlap(
      draft.appliesFrom,
      draft.appliesTo,
      result.appliesFrom,
      result.appliesTo,
    );
    const currentView = isCurrentView(result);
    const selectionReasons = [`search score=${result.score.toFixed(2)}`];
    let selectionScore = result.score;
    if (sameType) {
      selectionScore += 12;
      selectionReasons.push(`type=${result.type}`);
    }
    if (matchingKeywords.length) {
      selectionScore += Math.min(matchingKeywords.length, 3) * 8;
      selectionReasons.push(`keyword=${matchingKeywords.join(", ")}`);
    }
    if (overlappingVersion) {
      selectionScore += 6;
      selectionReasons.push("version range overlaps");
    }
    if (currentView && overlappingVersion) {
      selectionScore += 6;
      selectionReasons.push("Current View in scope");
    }
    return {
      id: result.id,
      title: result.title,
      summary: result.summary,
      type: result.type,
      keywords: [...result.keywords],
      appliesFrom: result.appliesFrom,
      appliesTo: result.appliesTo,
      path: result.path,
      body: result.body,
      content: result.content,
      searchScore: result.score,
      searchReasons: [...result.scoreBreakdown.reasons],
      isCurrentView: currentView,
      selectionScore,
      selectionReasons,
    };
  }).sort((left, right) =>
    right.selectionScore - left.selectionScore
    || right.searchScore - left.searchScore
    || left.title.localeCompare(right.title, "ja")
  ).slice(0, limit);
}

function isRelationKind(value: unknown): value is RelationKind {
  return typeof value === "string" && relationKinds.includes(value as RelationKind);
}

function validatedSuggestions(
  candidates: readonly RelationCandidate[],
  classifications: readonly RelationClassification[],
): RelationSuggestion[] {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const seen = new Set<string>();
  const suggestions: RelationSuggestion[] = [];
  for (const classification of classifications) {
    const candidate = byId.get(classification.id);
    if (
      !candidate
      || seen.has(classification.id)
      || !isRelationKind(classification.relation)
      || !classification.reason?.trim()
    ) {
      throw new Error("Language Modelが候補集合外または不完全な関係を返しました。");
    }
    seen.add(classification.id);
    suggestions.push({
      id: candidate.id,
      relation: classification.relation,
      reason: classification.reason.trim(),
      evidence: {
        id: candidate.id,
        title: candidate.title,
        path: candidate.path,
      },
      isCurrentView: candidate.isCurrentView,
    });
  }
  return suggestions;
}

export async function classifyRelationCandidates(
  draft: KnowledgeDraft,
  candidates: readonly RelationCandidate[],
  classifier?: RelationClassifier,
): Promise<RelationSuggestionOutcome> {
  if (!candidates.length) return { status: "none" };
  if (!classifier) {
    return {
      status: "unavailable",
      reason: "Language Modelを利用できません。",
    };
  }

  try {
    const suggestions = validatedSuggestions(
      candidates,
      await classifier.classify(draft, candidates),
    );
    return suggestions.length ? { status: "suggestions", suggestions } : { status: "none" };
  } catch (error) {
    return {
      status: "unavailable",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
