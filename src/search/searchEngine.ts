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

export function rankKnowledgeDocuments(
  documents: ParsedKnowledgeDocument[],
  query: string,
): KnowledgeSearchResult[] {
  const terms = [...new Set(normalizeSearchText(query).split(/\s+/).filter(Boolean))];
  if (!terms.length) return [];

  const results: KnowledgeSearchResult[] = [];
  for (const document of documents) {
    const title = normalizeSearchText(document.title);
    const summary = normalizeSearchText(document.summary);
    const keywords = document.keywords.map(normalizeSearchText);
    const body = normalizeSearchText(document.body);
    let score = 0;
    const matchedTerms: string[] = [];

    for (const term of terms) {
      let matched = false;
      if (title.includes(term)) { score += 10; matched = true; }
      if (summary.includes(term)) { score += 6; matched = true; }
      if (keywords.some((keyword) => keyword.includes(term))) { score += 4; matched = true; }
      if (body.includes(term)) { score += 1; matched = true; }
      if (matched) matchedTerms.push(term);
    }

    if (!matchedTerms.length) continue;
    if (matchedTerms.length === terms.length && terms.length > 1) score += 3;
    results.push({ ...document, score, matchedTerms });
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
