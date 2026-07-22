import * as path from "node:path";
import * as vscode from "vscode";
import { findKnowledgeMarkdownFiles } from "../knowledge/knowledgeFiles";
import {
  SqliteKnowledgeIndex,
  createFtsQuery,
  type KnowledgeIndexSource,
  type KnowledgeIndexStorage,
  type KnowledgeIndexSyncResult,
} from "./sqliteIndex";
import {
  searchHybridKnowledgeDocuments,
  searchKnowledgeDocuments,
  parseKnowledgeDocument,
  type KnowledgeDocument,
  type KnowledgeSearchResult,
  type SemanticDocumentScore,
} from "./searchEngine";
import {
  EmbeddingIndex,
  type EmbeddingIndexSource,
  type EmbeddingIndexStorage,
  type EmbeddingIndexSyncResult,
} from "./embeddingIndex";
import {
  cosineSimilarity,
  embeddingProviderKey,
  normalizeEmbedding,
  type EmbeddingProvider,
} from "./embeddingProvider";
import { OllamaEmbeddingProvider } from "./ollamaEmbeddingProvider";

const indexDirectory = ".totonoe";
const indexFile = "index.sqlite";
const vectorDirectory = "vectors";
const vectorIndexFile = "index.json";
const semanticCandidateLimit = 50;

interface WorkspaceKnowledgeSource extends KnowledgeIndexSource, EmbeddingIndexSource {
  uri: vscode.Uri;
}

export interface WorkspaceSearchResult {
  results: KnowledgeSearchResult[];
  backend: "hybrid" | "sqlite" | "scan";
  sync?: KnowledgeIndexSyncResult;
  indexError?: Error;
  embeddingSync?: Omit<EmbeddingIndexSyncResult, "vectors">;
  embeddingError?: Error;
  embeddingProvider?: string;
}

class VscodeIndexStorage implements KnowledgeIndexStorage {
  private readonly directory: vscode.Uri;
  private readonly target: vscode.Uri;

  constructor(root: vscode.Uri) {
    this.directory = vscode.Uri.joinPath(root, indexDirectory);
    this.target = vscode.Uri.joinPath(this.directory, indexFile);
  }

  async read(): Promise<Uint8Array | undefined> {
    try {
      return await vscode.workspace.fs.readFile(this.target);
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") return undefined;
      throw error;
    }
  }

  async write(data: Uint8Array): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.directory);
    const temporary = vscode.Uri.joinPath(
      this.directory,
      `${indexFile}.${process.pid}.${Date.now()}.tmp`,
    );
    await vscode.workspace.fs.writeFile(temporary, data);
    try {
      await vscode.workspace.fs.rename(temporary, this.target, { overwrite: true });
    } catch (error) {
      try {
        await vscode.workspace.fs.delete(temporary);
      } catch {
        // Preserve the original rename error.
      }
      throw error;
    }
  }
}

class VscodeEmbeddingIndexStorage implements EmbeddingIndexStorage {
  private readonly directory: vscode.Uri;
  private readonly target: vscode.Uri;

  constructor(root: vscode.Uri) {
    this.directory = vscode.Uri.joinPath(root, indexDirectory, vectorDirectory);
    this.target = vscode.Uri.joinPath(this.directory, vectorIndexFile);
  }

  async read(): Promise<string | undefined> {
    try {
      return Buffer.from(await vscode.workspace.fs.readFile(this.target)).toString("utf8");
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") return undefined;
      throw error;
    }
  }

  async write(data: string): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.directory);
    const temporary = vscode.Uri.joinPath(
      this.directory,
      `${vectorIndexFile}.${process.pid}.${Date.now()}.tmp`,
    );
    await vscode.workspace.fs.writeFile(temporary, Buffer.from(data, "utf8"));
    try {
      await vscode.workspace.fs.rename(temporary, this.target, { overwrite: true });
    } catch (error) {
      try {
        await vscode.workspace.fs.delete(temporary);
      } catch {
        // Preserve the original rename error.
      }
      throw error;
    }
  }
}

const indexes = new Map<string, SqliteKnowledgeIndex>();
const embeddingIndexes = new Map<string, EmbeddingIndex>();

function indexFor(root: vscode.Uri): SqliteKnowledgeIndex {
  const key = root.toString(true);
  let index = indexes.get(key);
  if (!index) {
    index = new SqliteKnowledgeIndex(new VscodeIndexStorage(root));
    indexes.set(key, index);
  }
  return index;
}

function embeddingIndexFor(root: vscode.Uri, provider: EmbeddingProvider): EmbeddingIndex {
  const key = `${root.toString(true)}:${embeddingProviderKey(provider)}`;
  let index = embeddingIndexes.get(key);
  if (!index) {
    index = new EmbeddingIndex(new VscodeEmbeddingIndexStorage(root), provider);
    embeddingIndexes.set(key, index);
  }
  return index;
}

function relativePath(root: vscode.Uri, uri: vscode.Uri): string {
  return path.posix.relative(root.path, uri.path);
}

async function collectSources(
  repositoryRoot: vscode.Uri,
): Promise<WorkspaceKnowledgeSource[]> {
  const files = await findKnowledgeMarkdownFiles(repositoryRoot);
  return Promise.all(files.map(async (uri) => {
    const stat = await vscode.workspace.fs.stat(uri);
    let content: Promise<string> | undefined;
    const readContent = async (): Promise<string> => {
      content ??= Promise.resolve(vscode.workspace.fs.readFile(uri))
        .then((bytes) => Buffer.from(bytes).toString("utf8"));
      return await content;
    };
    return {
      uri,
      path: relativePath(repositoryRoot, uri),
      fingerprint: `${stat.mtime}:${stat.size}`,
      readContent,
      readEmbeddingText: async () => {
        const parsed = parseKnowledgeDocument({
          path: relativePath(repositoryRoot, uri),
          content: await readContent(),
        });
        return [
          parsed.title,
          parsed.summary,
          parsed.keywords.join(" "),
          parsed.type,
          parsed.status,
          Array.from(parsed.body).slice(0, 8_000).join(""),
        ].filter(Boolean).join("\n");
      },
    };
  }));
}

async function readDocuments(
  sources: WorkspaceKnowledgeSource[],
): Promise<KnowledgeDocument[]> {
  return Promise.all(sources.map(async (source) => ({
    path: source.path,
    content: await source.readContent(),
  })));
}

interface EmbeddingConfiguration {
  provider?: EmbeddingProvider;
  minimumSimilarity: number;
}

export function configuredEmbeddingProvider(): EmbeddingConfiguration {
  const configuration = vscode.workspace.getConfiguration("totonoeKnowledge");
  if (configuration.get<string>("embedding.provider", "disabled") !== "ollama") {
    return { minimumSimilarity: -1 };
  }
  const configuredMinimum = configuration.get<number>("embedding.minimumSimilarity", -1);
  return {
    provider: new OllamaEmbeddingProvider({
      endpoint: configuration.get<string>("embedding.ollama.endpoint", "http://127.0.0.1:11434"),
      model: configuration.get<string>("embedding.ollama.model", "embeddinggemma"),
    }),
    minimumSimilarity: configuredMinimum >= -1 && configuredMinimum < 1 ? configuredMinimum : -1,
  };
}

async function lexicalSearch(
  sources: WorkspaceKnowledgeSource[],
  indexRoot: vscode.Uri,
  query: string,
  version?: string,
): Promise<WorkspaceSearchResult> {
  if (version || !createFtsQuery(query)) {
    return {
      results: searchKnowledgeDocuments(await readDocuments(sources), query, version ? { version } : {}),
      backend: "scan",
    };
  }
  try {
    const index = indexFor(indexRoot);
    const sync = await index.sync(sources);
    const candidates = new Set(await index.candidatePaths(query));
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

export async function searchWorkspaceKnowledge(
  repositoryRoot: vscode.Uri,
  indexRoot: vscode.Uri,
  query: string,
  version?: string,
): Promise<WorkspaceSearchResult> {
  const sources = await collectSources(repositoryRoot);
  let embedding: EmbeddingConfiguration;
  try {
    embedding = configuredEmbeddingProvider();
  } catch (error) {
    const fallback = await lexicalSearch(sources, indexRoot, query, version);
    return {
      ...fallback,
      embeddingError: error instanceof Error ? error : new Error(String(error)),
    };
  }
  if (!embedding.provider) return await lexicalSearch(sources, indexRoot, query, version);

  const providerKey = embeddingProviderKey(embedding.provider);
  try {
    const embeddingSync = await embeddingIndexFor(indexRoot, embedding.provider).sync(sources);
    const rawQueryVector = (await embedding.provider.embed([query]))[0];
    if (!rawQueryVector) throw new Error("Embedding provider did not return a query vector.");
    const queryVector = normalizeEmbedding(rawQueryVector);
    const similarities = [...embeddingSync.vectors.entries()].map(([path, vector]) => ({
      path,
      similarity: cosineSimilarity(queryVector, vector),
    })).sort((left, right) => right.similarity - left.similarity);
    const semanticCandidates = similarities
      .filter(({ similarity }) => similarity >= embedding.minimumSimilarity)
      .slice(0, semanticCandidateLimit);
    const candidatePaths = new Set(semanticCandidates.map(({ path }) => path));
    let sync: KnowledgeIndexSyncResult | undefined;
    let indexError: Error | undefined;

    if (!version && createFtsQuery(query)) {
      try {
        const index = indexFor(indexRoot);
        sync = await index.sync(sources);
        for (const path of await index.candidatePaths(query)) candidatePaths.add(path);
      } catch (error) {
        indexError = error instanceof Error ? error : new Error(String(error));
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
        minimumSemanticSimilarity: embedding.minimumSimilarity,
      }),
      backend: "hybrid",
      sync,
      indexError,
      embeddingSync: embeddingSyncSummary,
      embeddingProvider: providerKey,
    };
  } catch (error) {
    const fallback = await lexicalSearch(sources, indexRoot, query, version);
    return {
      ...fallback,
      embeddingProvider: providerKey,
      embeddingError: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

export async function rebuildWorkspaceKnowledgeIndex(
  repositoryRoot: vscode.Uri,
  indexRoot: vscode.Uri,
): Promise<KnowledgeIndexSyncResult> {
  return indexFor(indexRoot).sync(await collectSources(repositoryRoot), true);
}

export function knowledgeIndexUri(indexRoot: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(indexRoot, indexDirectory, indexFile);
}

export function knowledgeEmbeddingIndexUri(indexRoot: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(indexRoot, indexDirectory, vectorDirectory, vectorIndexFile);
}
