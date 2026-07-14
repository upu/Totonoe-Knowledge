export interface KnowledgeDocument {
  path: string;
  content: string;
}

export interface ParsedKnowledgeDocument extends KnowledgeDocument {
  id: string;
  title: string;
  summary: string;
  type: string;
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

function scalar(frontmatter: string, key: string): string | undefined {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  if (!match) return undefined;
  const value = match[1].trim();
  if (value.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === "string" ? parsed : value;
    } catch {
      return value.replace(/^"|"$/g, "");
    }
  }
  return value;
}

function stringList(frontmatter: string, key: string): string[] {
  const lines = frontmatter.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `${key}:`);
  if (start < 0) return [];
  const values: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s+-\s+(.+)$/);
    if (!match) break;
    const raw = match[1].trim();
    try {
      const parsed: unknown = JSON.parse(raw);
      values.push(typeof parsed === "string" ? parsed : raw);
    } catch {
      values.push(raw.replace(/^"|"$/g, ""));
    }
  }
  return values;
}

export function parseKnowledgeDocument(document: KnowledgeDocument): ParsedKnowledgeDocument {
  const match = document.content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const frontmatter = match?.[1] ?? "";
  return {
    ...document,
    id: scalar(frontmatter, "id") ?? "unknown",
    title: scalar(frontmatter, "title") ?? document.path,
    summary: scalar(frontmatter, "summary") ?? "",
    type: scalar(frontmatter, "type") ?? "unknown",
    keywords: stringList(frontmatter, "keywords"),
    body: match ? document.content.slice(match[0].length) : document.content,
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
