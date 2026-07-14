import { frontmatterList, frontmatterString, parseFrontmatter } from "../knowledge/frontmatter";

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
  keywords: string[];
  body: string;
}

export interface KnowledgeSearchResult extends ParsedKnowledgeDocument {
  score: number;
  matchedTerms: string[];
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase();
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
    keywords: frontmatterList(frontmatter, "keywords") ?? [],
    body: frontmatter.body,
  };
}

export function searchKnowledgeDocuments(
  documents: KnowledgeDocument[],
  query: string,
): KnowledgeSearchResult[] {
  const terms = [...new Set(normalize(query).split(/\s+/).filter(Boolean))];
  if (!terms.length) return [];

  const results: KnowledgeSearchResult[] = [];
  for (const document of documents.map(parseKnowledgeDocument)) {
    const title = normalize(document.title);
    const summary = normalize(document.summary);
    const keywords = document.keywords.map(normalize);
    const body = normalize(document.body);
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
