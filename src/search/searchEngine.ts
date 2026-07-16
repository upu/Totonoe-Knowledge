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
  scoreBreakdown: SearchScoreBreakdown;
}

export interface SearchScoreBreakdown {
  fullText: number;
  metadata: number;
  semantic: number;
  semanticSimilarity?: number;
  embeddingProvider?: string;
  reasons: string[];
}

export interface SemanticDocumentScore {
  similarity: number;
  provider: string;
}

export interface HybridSearchOptions extends KnowledgeSearchOptions {
  minimumSemanticSimilarity?: number;
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

interface LexicalScore {
  fullText: number;
  metadata: number;
  matchedTerms: string[];
  hasEvidence: boolean;
  hasExactTerm: boolean;
}

function lexicalScore(document: ParsedKnowledgeDocument, query: string): LexicalScore {
  const terms = [...new Set(normalizeSearchText(query).split(/\s+/).filter(Boolean))];
  const activeQueryUnits = createSearchQueryUnits(query);
  const title = normalizeSearchText(document.title);
  const summary = normalizeSearchText(document.summary);
  const keywords = document.keywords.map(normalizeSearchText);
  const body = normalizeSearchText(document.body);
  const type = normalizeSearchText(document.type);
  const status = normalizeSearchText(document.status);
  let fullText = 0;
  let metadata = 0;
  const matchedTerms = new Set<string>();

  for (const term of terms) {
    let matched = false;
    if (title.includes(term)) { fullText += 10; matched = true; }
    if (summary.includes(term)) { fullText += 6; matched = true; }
    if (keywords.some((keyword) => keyword.includes(term))) { metadata += 4; matched = true; }
    if (body.includes(term)) { fullText += 1; matched = true; }
    if (type === term) { metadata += 3; matched = true; }
    if (status === term) { metadata += 2; matched = true; }
    if (matched) matchedTerms.add(term);
  }

  let matchedBigrams = 0;
  let matchedTrigrams = 0;
  let matchedExactUnits = 0;
  for (const unit of activeQueryUnits) {
    const fullTextWeight = Math.max(
      title.includes(unit.value) ? 10 : 0,
      summary.includes(unit.value) ? 6 : 0,
      body.includes(unit.value) ? 1 : 0,
    );
    const metadataWeight = Math.max(
      keywords.some((keyword) => keyword.includes(unit.value)) ? 4 : 0,
      type.includes(unit.value) ? 3 : 0,
      status.includes(unit.value) ? 2 : 0,
    );
    const fieldWeight = Math.max(fullTextWeight, metadataWeight);
    if (!fieldWeight) continue;
    const unitWeight = unit.kind === "trigram" ? 1 : unit.kind === "bigram" ? 0.45 : 1;
    const evidenceBonus = unit.kind === "trigram" ? 3 : unit.kind === "bigram" ? 0.75 : 12;
    const score = fieldWeight * unitWeight + evidenceBonus;
    if (fullTextWeight >= metadataWeight) fullText += score;
    else metadata += score;
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
    || type === term
    || status === term
  );
  const hasEnoughFuzzyEvidence = matchedTrigrams >= 1 || matchedBigrams >= 2;
  if (terms.length > 1 && terms.every((term) => matchedTerms.has(term))) fullText += 3;
  return {
    fullText,
    metadata,
    matchedTerms: [...matchedTerms],
    hasEvidence: hasExactTerm || hasEnoughFuzzyEvidence || matchedExactUnits > 0,
    hasExactTerm,
  };
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
    const lexical = lexicalScore(document, query);
    if (!lexical.hasEvidence) continue;
    const score = lexical.fullText + lexical.metadata;
    results.push({
      ...document,
      score,
      matchedTerms: lexical.matchedTerms,
      scoreBreakdown: {
        fullText: lexical.fullText,
        metadata: lexical.metadata,
        semantic: 0,
        reasons: [
          `全文=${lexical.fullText.toFixed(2)}`,
          `metadata=${lexical.metadata.toFixed(2)}`,
        ],
      },
    });
  }

  return results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, "ja"));
}

export function rankHybridKnowledgeDocuments(
  documents: ParsedKnowledgeDocument[],
  query: string,
  semanticScores: ReadonlyMap<string, SemanticDocumentScore>,
  options: HybridSearchOptions = {},
): KnowledgeSearchResult[] {
  const minimumSimilarity = options.minimumSemanticSimilarity ?? 0.45;
  if (!(minimumSimilarity >= -1 && minimumSimilarity < 1)) {
    throw new Error("minimumSemanticSimilarityは-1以上1未満で指定してください。");
  }
  const effective = options.version
    ? effectiveKnowledgeDocuments(documents, options.version)
    : documents;
  const results: KnowledgeSearchResult[] = [];

  for (const document of effective) {
    const lexical = lexicalScore(document, query);
    const semantic = semanticScores.get(document.path);
    const similarity = semantic?.similarity;
    const hasSemanticEvidence = similarity !== undefined && similarity >= minimumSimilarity;
    if (!lexical.hasEvidence && !hasSemanticEvidence) continue;

    const fullTextComponent = Math.min(lexical.fullText / 40, 1) * 45;
    const metadataComponent = Math.min(lexical.metadata / 20, 1) * 10;
    const semanticComponent = similarity === undefined
      ? 0
      : Math.max(0, Math.min((similarity - minimumSimilarity) / (1 - minimumSimilarity), 1)) * 45;
    const exactBonus = lexical.hasExactTerm ? 20 : 0;
    const score = fullTextComponent + metadataComponent + semanticComponent + exactBonus;
    const reasons = [
      `全文=${lexical.fullText.toFixed(2)}→${fullTextComponent.toFixed(2)}`,
      `metadata=${lexical.metadata.toFixed(2)}→${metadataComponent.toFixed(2)}`,
    ];
    if (similarity !== undefined) {
      reasons.push(`意味=${similarity.toFixed(4)}→${semanticComponent.toFixed(2)}`);
    }
    if (exactBonus) reasons.push(`完全一致bonus=${exactBonus.toFixed(2)}`);

    results.push({
      ...document,
      score,
      matchedTerms: lexical.matchedTerms,
      scoreBreakdown: {
        fullText: fullTextComponent,
        metadata: metadataComponent,
        semantic: semanticComponent,
        semanticSimilarity: similarity,
        embeddingProvider: semantic?.provider,
        reasons,
      },
    });
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

export function searchHybridKnowledgeDocuments(
  documents: KnowledgeDocument[],
  query: string,
  semanticScores: ReadonlyMap<string, SemanticDocumentScore>,
  options: HybridSearchOptions = {},
): KnowledgeSearchResult[] {
  return rankHybridKnowledgeDocuments(
    documents.map(parseKnowledgeDocument),
    query,
    semanticScores,
    options,
  );
}
