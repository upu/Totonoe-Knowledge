import { frontmatterList, frontmatterString, parseFrontmatter } from "../knowledge/frontmatter";
import { isVersionInRange, parseComparableVersion } from "../knowledge/versioning";

export interface KnowledgeDocument {
  path: string;
  content: string;
}

export interface ParsedKnowledgeDocument extends KnowledgeDocument {
  id: string;
  title: string;
  summary: string;
  type: string;
  status: string;
  appliesFrom: string;
  appliesTo: string;
  supersedes: string[];
  keywords: string[];
  body: string;
}

export interface KnowledgeSearchResult extends ParsedKnowledgeDocument {
  score: number;
  matchedTerms: string[];
}

export interface KnowledgeSearchOptions {
  version?: string;
}

export function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase();
}

export interface SearchQueryUnit {
  value: string;
  kind: "exact" | "bigram" | "trigram";
}

const lowInformationJapaneseNgrams = new Set([
  "ある", "いる", "から", "こと", "この", "され", "した", "して", "する", "せる",
  "その", "ため", "てい", "です", "でも", "とは", "ない", "なっ", "にも", "ので",
  "のに", "まで", "ます", "もの", "よう", "られ", "れる", "である", "できる", "がある",
  "される", "しない", "として", "ている", "になる", "にする",
]);

function searchableSegments(value: string): string[] {
  return normalizeSearchText(value).match(
    /[a-z0-9]+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]+/gu,
  ) ?? [];
}

function ngrams(value: string, size: number): string[] {
  const characters = Array.from(value);
  return Array.from(
    { length: Math.max(0, characters.length - size + 1) },
    (_, index) => characters.slice(index, index + size).join(""),
  );
}

export function createSearchQueryUnits(query: string): SearchQueryUnit[] {
  const units: SearchQueryUnit[] = [];
  for (const segment of searchableSegments(query)) {
    const characters = Array.from(segment);
    const isAscii = /^[a-z0-9]+$/.test(segment);
    if (!isAscii && characters.length === 1) continue;
    if (isAscii || characters.length <= 3) {
      units.push({ value: segment, kind: "exact" });
      continue;
    }
    units.push(...[
      ...ngrams(segment, 3).map((value): SearchQueryUnit => ({ value, kind: "trigram" })),
      ...ngrams(segment, 2).map((value): SearchQueryUnit => ({ value, kind: "bigram" })),
    ].filter((unit) => !lowInformationJapaneseNgrams.has(unit.value)));
  }
  return [...new Map(units.map((unit) => [`${unit.kind}:${unit.value}`, unit])).values()];
}

export function rankKnowledgeDocuments(
  documents: ParsedKnowledgeDocument[],
  query: string,
): KnowledgeSearchResult[] {
  const terms = [...new Set(normalizeSearchText(query).split(/\s+/).filter(Boolean))];
  const activeQueryUnits = createSearchQueryUnits(query);
  if (!terms.length || !activeQueryUnits.length) return [];

  const results: KnowledgeSearchResult[] = [];
  for (const document of documents) {
    const title = normalizeSearchText(document.title);
    const summary = normalizeSearchText(document.summary);
    const keywords = document.keywords.map(normalizeSearchText);
    const body = normalizeSearchText(document.body);
    let score = 0;
    const matchedTerms = new Set<string>();

    for (const term of terms) {
      let matched = false;
      if (title.includes(term)) { score += 10; matched = true; }
      if (summary.includes(term)) { score += 6; matched = true; }
      if (keywords.some((keyword) => keyword.includes(term))) { score += 4; matched = true; }
      if (body.includes(term)) { score += 1; matched = true; }
      if (matched) matchedTerms.add(term);
    }

    let matchedBigrams = 0;
    let matchedTrigrams = 0;
    let matchedExactUnits = 0;
    for (const unit of activeQueryUnits) {
      const fieldWeight = Math.max(
        title.includes(unit.value) ? 10 : 0,
        summary.includes(unit.value) ? 6 : 0,
        keywords.some((keyword) => keyword.includes(unit.value)) ? 4 : 0,
        body.includes(unit.value) ? 1 : 0,
      );
      if (!fieldWeight) continue;
      const unitWeight = unit.kind === "trigram" ? 1 : unit.kind === "bigram" ? 0.45 : 1;
      const evidenceBonus = unit.kind === "trigram" ? 3 : unit.kind === "bigram" ? 0.75 : 12;
      score += fieldWeight * unitWeight + evidenceBonus;
      matchedTerms.add(unit.value);
      if (unit.kind === "bigram") matchedBigrams += 1;
      else if (unit.kind === "trigram") matchedTrigrams += 1;
      else matchedExactUnits += 1;
    }

    const hasExactTerm = terms.some((term) =>
      title.includes(term)
      || summary.includes(term)
      || keywords.some((keyword) => keyword.includes(term))
      || body.includes(term)
    );
    const hasEnoughFuzzyEvidence = matchedTrigrams >= 1 || matchedBigrams >= 2;
    if (!hasExactTerm && !hasEnoughFuzzyEvidence && !matchedExactUnits) continue;
    if (terms.length > 1 && terms.every((term) => matchedTerms.has(term))) score += 3;
    results.push({ ...document, score, matchedTerms: [...matchedTerms] });
  }

  return results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, "ja"));
}

export function parseKnowledgeDocument(document: KnowledgeDocument): ParsedKnowledgeDocument {
  const frontmatter = parseFrontmatter(document.content);
  return {
    ...document,
    id: frontmatterString(frontmatter, "id") ?? "unknown",
    title: frontmatterString(frontmatter, "title") ?? document.path,
    summary: frontmatterString(frontmatter, "summary") ?? "",
    type: frontmatterString(frontmatter, "type") ?? "unknown",
    status: frontmatterString(frontmatter, "status") ?? "unknown",
    appliesFrom: frontmatterString(frontmatter, "applies_from") ?? "",
    appliesTo: frontmatterString(frontmatter, "applies_to") ?? "",
    supersedes: frontmatterList(frontmatter, "supersedes") ?? [],
    keywords: frontmatterList(frontmatter, "keywords") ?? [],
    body: frontmatter.body,
  };
}

export function effectiveKnowledgeDocuments(
  documents: ParsedKnowledgeDocument[],
  version: string,
): ParsedKnowledgeDocument[] {
  if (!parseComparableVersion(version)) throw new Error(`比較できない対象バージョンです: ${version}`);
  const byId = new Map(documents.map((document) => [document.id, document]));
  const applicable = documents.filter((document) =>
    isVersionInRange(version, document.appliesFrom, document.appliesTo),
  );
  const superseded = new Set<string>();
  const collectSuperseded = (id: string, visited: Set<string>): void => {
    if (visited.has(id)) return;
    visited.add(id);
    superseded.add(id);
    for (const ancestor of byId.get(id)?.supersedes ?? []) collectSuperseded(ancestor, visited);
  };
  for (const document of applicable) {
    for (const id of document.supersedes) collectSuperseded(id, new Set());
  }
  return applicable.filter((document) => !superseded.has(document.id));
}

export function searchKnowledgeDocuments(
  documents: KnowledgeDocument[],
  query: string,
  options: KnowledgeSearchOptions = {},
): KnowledgeSearchResult[] {
  const parsed = documents.map(parseKnowledgeDocument);
  const effective = options.version
    ? effectiveKnowledgeDocuments(parsed, options.version)
    : parsed;
  return rankKnowledgeDocuments(effective, query);
}
