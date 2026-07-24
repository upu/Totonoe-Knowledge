import {
  EmbeddingIndex,
  type EmbeddingIndexSource,
  type EmbeddingIndexSyncResult,
} from "./embeddingIndex";
import {
  cosineSimilarity,
  embeddingProviderKey,
  normalizeEmbedding,
  type EmbeddingProvider,
} from "./embeddingProvider";
import {
  parseKnowledgeDocument,
  searchHybridKnowledgeDocuments,
  searchKnowledgeDocuments,
  type KnowledgeDocument,
  type KnowledgeSearchResult,
  type SemanticDocumentScore,
} from "./searchEngine";
import {
  createFtsQuery,
  SqliteKnowledgeIndex,
  type KnowledgeIndexSource,
  type KnowledgeIndexSyncResult,
} from "./sqliteIndex";

const semanticCandidateLimit = 50;

export interface KnowledgeSearchSource extends KnowledgeIndexSource, EmbeddingIndexSource {}

export interface KnowledgeSearchResponse {
  results: KnowledgeSearchResult[];
  backend: "hybrid" | "sqlite" | "scan";
  sync?: KnowledgeIndexSyncResult;
  indexError?: Error;
  embeddingSync?: Omit<EmbeddingIndexSyncResult, "vectors">;
  embeddingError?: Error;
  embeddingProvider?: string;
}

export interface SemanticSearchRuntime {
  provider: EmbeddingProvider;
  index: EmbeddingIndex;
  minimumSimilarity: number;
}

export interface KnowledgeSearchRuntime {
  lexicalIndex?: SqliteKnowledgeIndex;
  semantic?: SemanticSearchRuntime;
}

export function embeddingTextForDocument(document: KnowledgeDocument): string {
  const parsed = parseKnowledgeDocument(document);
  return [
    parsed.title,
    parsed.summary,
    parsed.keywords.join(" "),
    parsed.type,
    parsed.status,
    Array.from(parsed.body).slice(0, 8_000).join(""),
  ].filter(Boolean).join("\n");
}

async function readDocuments(
  sources: readonly KnowledgeSearchSource[],
): Promise<KnowledgeDocument[]> {
  return Promise.all(sources.map(async (source) => ({
    path: source.path,
    content: await source.readContent(),
  })));
}

async function lexicalSearch(
  sources: readonly KnowledgeSearchSource[],
  query: string,
  runtime: KnowledgeSearchRuntime,
  version?: string,
): Promise<KnowledgeSearchResponse> {
  if (version || !createFtsQuery(query) || !runtime.lexicalIndex) {
    return {
      results: searchKnowledgeDocuments(await readDocuments(sources), query, version ? { version } : {}),
      backend: "scan",
    };
  }

  try {
    const sync = await runtime.lexicalIndex.sync([...sources]);
    const candidates = new Set(await runtime.lexicalIndex.candidatePaths(query));
    const documents = await readDocuments(sources.filter((source) => candidates.has(source.path)));
    return { results: searchKnowledgeDocuments(documents, query), backend: "sqlite", sync };
  } catch (error) {
    return {
      results: searchKnowledgeDocuments(await readDocuments(sources), query),
      backend: "scan",
      indexError: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

export async function searchKnowledgeSources(
  sources: readonly KnowledgeSearchSource[],
  query: string,
  runtime: KnowledgeSearchRuntime,
  version?: string,
): Promise<KnowledgeSearchResponse> {
  const semantic = runtime.semantic;
  if (!semantic) return await lexicalSearch(sources, query, runtime, version);

  const providerKey = embeddingProviderKey(semantic.provider);
  try {
    const embeddingSync = await semantic.index.sync(sources);
    const rawQueryVector = (await semantic.provider.embed([query]))[0];
    if (!rawQueryVector) throw new Error("Embedding provider did not return a query vector.");
    const queryVector = normalizeEmbedding(rawQueryVector);
    const similarities = [...embeddingSync.vectors.entries()].map(([path, vector]) => ({
      path,
      similarity: cosineSimilarity(queryVector, vector),
    })).sort((left, right) => right.similarity - left.similarity);
    const semanticCandidates = similarities
      .filter(({ similarity }) => similarity >= semantic.minimumSimilarity)
      .slice(0, semanticCandidateLimit);
    const candidatePaths = new Set(semanticCandidates.map(({ path }) => path));
    let sync: KnowledgeIndexSyncResult | undefined;
    let indexError: Error | undefined;

    if (!version && createFtsQuery(query)) {
      if (runtime.lexicalIndex) {
        try {
          sync = await runtime.lexicalIndex.sync([...sources]);
          for (const path of await runtime.lexicalIndex.candidatePaths(query)) candidatePaths.add(path);
        } catch (error) {
          indexError = error instanceof Error ? error : new Error(String(error));
          for (const source of sources) candidatePaths.add(source.path);
        }
      } else {
        for (const source of sources) candidatePaths.add(source.path);
      }
    }
    if (version) for (const source of sources) candidatePaths.add(source.path);

    const documents = await readDocuments(sources.filter((source) => candidatePaths.has(source.path)));
    const semanticScores = new Map<string, SemanticDocumentScore>(similarities.map(({ path, similarity }) => [
      path,
      { similarity, provider: providerKey },
    ]));
    const { vectors: _vectors, ...embeddingSyncSummary } = embeddingSync;
    return {
      results: searchHybridKnowledgeDocuments(documents, query, semanticScores, {
        version,
        minimumSemanticSimilarity: semantic.minimumSimilarity,
      }),
      backend: "hybrid",
      sync,
      indexError,
      embeddingSync: embeddingSyncSummary,
      embeddingProvider: providerKey,
    };
  } catch (error) {
    const fallback = await lexicalSearch(sources, query, runtime, version);
    return {
      ...fallback,
      embeddingProvider: providerKey,
      embeddingError: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
