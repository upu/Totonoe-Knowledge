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
  searchKnowledgeDocuments,
  type KnowledgeDocument,
  type KnowledgeSearchResult,
} from "./searchEngine";

const indexDirectory = ".totonoe";
const indexFile = "index.sqlite";

interface WorkspaceKnowledgeSource extends KnowledgeIndexSource {
  uri: vscode.Uri;
}

export interface WorkspaceSearchResult {
  results: KnowledgeSearchResult[];
  backend: "sqlite" | "scan";
  sync?: KnowledgeIndexSyncResult;
  indexError?: Error;
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

const indexes = new Map<string, SqliteKnowledgeIndex>();

function indexFor(root: vscode.Uri): SqliteKnowledgeIndex {
  const key = root.toString(true);
  let index = indexes.get(key);
  if (!index) {
    index = new SqliteKnowledgeIndex(new VscodeIndexStorage(root));
    indexes.set(key, index);
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
    return {
      uri,
      path: relativePath(repositoryRoot, uri),
      fingerprint: `${stat.mtime}:${stat.size}`,
      readContent: async () => {
        content ??= Promise.resolve(vscode.workspace.fs.readFile(uri))
          .then((bytes) => Buffer.from(bytes).toString("utf8"));
        return await content;
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

export async function searchWorkspaceKnowledge(
  repositoryRoot: vscode.Uri,
  indexRoot: vscode.Uri,
  query: string,
  version?: string,
): Promise<WorkspaceSearchResult> {
  const sources = await collectSources(repositoryRoot);
  if (version) {
    return {
      results: searchKnowledgeDocuments(await readDocuments(sources), query, { version }),
      backend: "scan",
    };
  }
  if (!createFtsQuery(query)) {
    return {
      results: searchKnowledgeDocuments(await readDocuments(sources), query),
      backend: "scan",
    };
  }
  try {
    const index = indexFor(indexRoot);
    const sync = await index.sync(sources);
    const candidates = new Set(await index.candidatePaths(query));
    const documents = await readDocuments(sources.filter((source) => candidates.has(source.path)));
    return {
      results: searchKnowledgeDocuments(documents, query),
      backend: "sqlite",
      sync,
    };
  } catch (error) {
    return {
      results: searchKnowledgeDocuments(await readDocuments(sources), query),
      backend: "scan",
      indexError: error instanceof Error ? error : new Error(String(error)),
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
