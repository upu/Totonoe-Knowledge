import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import test from "node:test";
import {
  parseKnowledgeDocument,
  rankHybridKnowledgeDocuments,
  searchKnowledgeDocuments,
  type KnowledgeDocument,
} from "./searchEngine";
import {
  SqliteKnowledgeIndex,
  type KnowledgeIndexSource,
  type KnowledgeIndexStorage,
} from "./sqliteIndex";
import { searchKnowledgeSources, type KnowledgeSearchSource } from "./searchService";

interface RegressionCase {
  query: string;
  expectedId: string;
  maxRank: number;
}

interface RegressionEntry {
  id: string;
  title: string;
  summary: string;
  keywords: string[];
  body: string;
}

interface SemanticRegressionCase extends RegressionCase {
  similarities: Record<string, number>;
}

interface RegressionFixture {
  cases: RegressionCase[];
  semanticCases: SemanticRegressionCase[];
  entries: RegressionEntry[];
}

class MemoryStorage implements KnowledgeIndexStorage {
  data: Uint8Array | undefined;

  async read(): Promise<Uint8Array | undefined> {
    return this.data ? new Uint8Array(this.data) : undefined;
  }

  async write(data: Uint8Array): Promise<void> {
    this.data = new Uint8Array(data);
  }
}

const fixture = JSON.parse(fs.readFileSync(path.join(
  process.cwd(),
  "test-fixtures",
  "search",
  "dogfooding-regression.json",
), "utf8")) as RegressionFixture;

function markdown(entry: RegressionEntry): string {
  return `---
id: ${entry.id}
title: "${entry.title}"
summary: "${entry.summary}"
type: investigation
status: active
keywords:
${entry.keywords.map((keyword) => `  - "${keyword}"`).join("\n")}
---

${entry.body}
`;
}

const documents: KnowledgeDocument[] = fixture.entries.map((entry) => ({
  path: `${entry.id}.md`,
  content: markdown(entry),
}));

function assertExpectedRank(results: ReturnType<typeof searchKnowledgeDocuments>, regression: RegressionCase): void {
  const rank = results.findIndex((result) => result.id === regression.expectedId) + 1;
  assert.ok(
    rank > 0 && rank <= regression.maxRank,
    `${regression.query}: expected ${regression.expectedId} within rank ${regression.maxRank}, got ${rank || "no result"}`,
  );
}

test("keeps all 12 dogfooding queries discoverable in a direct Markdown scan", () => {
  for (const regression of fixture.cases) {
    assertExpectedRank(searchKnowledgeDocuments(documents, regression.query), regression);
  }
});

test("returns the same ranked dogfooding results from SQLite candidates and a direct scan", async () => {
  const storage = new MemoryStorage();
  const index = new SqliteKnowledgeIndex(storage);
  const byPath = new Map(documents.map((document) => [document.path, document]));
  const sources: KnowledgeIndexSource[] = documents.map((document, index) => ({
    path: document.path,
    fingerprint: `${index}:${document.content.length}`,
    readContent: async () => document.content,
  }));
  await index.sync(sources);

  for (const regression of fixture.cases) {
    const direct = searchKnowledgeDocuments(documents, regression.query);
    const candidatePaths = new Set(await index.candidatePaths(regression.query));
    const candidates = documents.filter((document) => candidatePaths.has(document.path));
    const indexed = searchKnowledgeDocuments(candidates, regression.query);
    assert.deepEqual(indexed.map((result) => result.id), direct.map((result) => result.id));
    assertExpectedRank(indexed, regression);
    assert.equal(candidatePaths.size <= 200, true);
    assert.equal(byPath.size, documents.length);
  }
});

test("keeps the dogfooding rankings through the search service shared by VS Code and MCP", async () => {
  const index = new SqliteKnowledgeIndex(new MemoryStorage());
  const sources: KnowledgeSearchSource[] = documents.map((document, sourceIndex) => ({
    path: document.path,
    fingerprint: `${sourceIndex}:${document.content.length}`,
    readContent: async () => document.content,
    readEmbeddingText: async () => document.content,
  }));

  for (const regression of fixture.cases) {
    const search = await searchKnowledgeSources(sources, regression.query, { lexicalIndex: index });
    assertExpectedRank(search.results, regression);
    assert.deepEqual(
      search.results.map((result) => result.id),
      searchKnowledgeDocuments(documents, regression.query).map((result) => result.id),
    );
  }
});

test("finds the semantic-only dogfooding query below the former absolute similarity threshold", () => {
  const parsed = documents.map(parseKnowledgeDocument);

  for (const regression of fixture.semanticCases) {
    const lexicalResults = searchKnowledgeDocuments(documents, regression.query);
    assert.equal(
      lexicalResults.some((result) => result.id === regression.expectedId),
      false,
      `${regression.query}: expected lexical-only search to miss ${regression.expectedId}`,
    );

    const semanticScores = new Map(Object.entries(regression.similarities).map(([id, similarity]) => {
      const document = parsed.find((candidate) => candidate.id === id);
      assert.ok(document, `missing semantic regression entry: ${id}`);
      return [document.path, { similarity, provider: "ollama:embeddinggemma" }] as const;
    }));
    const hybridResults = rankHybridKnowledgeDocuments(
      parsed,
      regression.query,
      semanticScores,
    );
    assertExpectedRank(hybridResults, regression);
    const expected = hybridResults.find((result) => result.id === regression.expectedId);
    assert.ok(expected);
    assert.ok(expected.scoreBreakdown.semantic > 0);
    assert.equal(expected.scoreBreakdown.semanticSimilarity, 0.3839);
    assert.ok(expected.scoreBreakdown.reasons.some((reason) => reason.includes("相対=1.0000")));
  }
});
