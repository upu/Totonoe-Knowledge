import * as path from "node:path";
import * as vscode from "vscode";
import { findKnowledgeMarkdownFiles } from "../knowledge/knowledgeFiles";
import {
  SqliteKnowledgeIndex,
  type KnowledgeIndexStorage,
  type KnowledgeIndexSyncResult,
} from "./sqliteIndex";
import {
  EmbeddingIndex,
  type EmbeddingIndexStorage,
} from "./embeddingIndex";
import {
  embeddingProviderKey,
  type EmbeddingProvider,
} from "./embeddingProvider";
import { OllamaEmbeddingProvider } from "./ollamaEmbeddingProvider";
import {
  embeddingTextForDocument,
  searchKnowledgeSources,
  type KnowledgeSearchResponse,
  type KnowledgeSearchSource,
} from "./searchService";

const indexDirectory = ".totonoe";
const indexFile = "index.sqlite";
const vectorDirectory = "vectors";
const vectorIndexFile = "index.json";
interface WorkspaceKnowledgeSource extends KnowledgeSearchSource {
  uri: vscode.Uri;
}

export type WorkspaceSearchResult = KnowledgeSearchResponse;

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
      readEmbeddingText: async () => embeddingTextForDocument({
        path: relativePath(repositoryRoot, uri),
        content: await readContent(),
      }),
    };
  }));
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
    const fallback = await searchKnowledgeSources(sources, query, {
      lexicalIndex: indexFor(indexRoot),
    }, version);
    return {
      ...fallback,
      embeddingError: error instanceof Error ? error : new Error(String(error)),
    };
  }
  return await searchKnowledgeSources(sources, query, {
    lexicalIndex: indexFor(indexRoot),
    semantic: embedding.provider ? {
      provider: embedding.provider,
      index: embeddingIndexFor(indexRoot, embedding.provider),
      minimumSimilarity: embedding.minimumSimilarity,
    } : undefined,
  }, version);
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
