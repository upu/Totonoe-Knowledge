import * as fs from "node:fs/promises";
import * as path from "node:path";
import { frontmatterString, parseFrontmatter } from "../knowledge/frontmatter";
import { knowledgeDirectories } from "../knowledge/markdown";
import { EmbeddingIndex, type EmbeddingIndexStorage } from "../search/embeddingIndex";
import type { EmbeddingProvider } from "../search/embeddingProvider";
import { parseKnowledgeDocument, type ParsedKnowledgeDocument } from "../search/searchEngine";
import {
  embeddingTextForDocument,
  searchKnowledgeSources,
  type KnowledgeSearchResponse,
  type KnowledgeSearchSource,
  type SemanticSearchRuntime,
} from "../search/searchService";
import { SqliteKnowledgeIndex, type KnowledgeIndexStorage } from "../search/sqliteIndex";

const indexDirectory = ".totonoe";
const indexFile = "index.sqlite";
const vectorIndexFile = path.join("vectors", "index.json");

async function readOptionalFile(target: string): Promise<Buffer | undefined> {
  try {
    return await fs.readFile(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function writeAtomic(target: string, data: Uint8Array | string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, data);
  try {
    await fs.rename(temporary, target);
  } catch (error) {
    try {
      await fs.rm(temporary, { force: true });
    } catch {
      // Preserve the original rename error.
    }
    throw error;
  }
}

class NodeIndexStorage implements KnowledgeIndexStorage {
  constructor(private readonly target: string) {}

  async read(): Promise<Uint8Array | undefined> {
    return await readOptionalFile(this.target);
  }

  async write(data: Uint8Array): Promise<void> {
    await writeAtomic(this.target, data);
  }
}

class NodeEmbeddingIndexStorage implements EmbeddingIndexStorage {
  constructor(private readonly target: string) {}

  async read(): Promise<string | undefined> {
    return (await readOptionalFile(this.target))?.toString("utf8");
  }

  async write(data: string): Promise<void> {
    await writeAtomic(this.target, data);
  }
}

async function collectMarkdownFiles(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectMarkdownFiles(target));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) files.push(target);
  }
  return files;
}

async function collectLegacyRootFiles(repositoryRoot: string): Promise<string[]> {
  const entries = await fs.readdir(repositoryRoot, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
    const target = path.join(repositoryRoot, entry.name);
    const id = frontmatterString(parseFrontmatter(await fs.readFile(target, "utf8")), "id");
    if (/^K-/i.test(id ?? "")) files.push(target);
  }
  return files;
}

function relativeReference(repositoryRoot: string, target: string): string {
  return path.relative(repositoryRoot, target).split(path.sep).join("/");
}

export async function collectNodeKnowledgeSources(
  repositoryRoot: string,
): Promise<KnowledgeSearchSource[]> {
  const files = (await Promise.all([
    collectLegacyRootFiles(repositoryRoot),
    ...knowledgeDirectories.map((directory) =>
      collectMarkdownFiles(path.join(repositoryRoot, directory))),
  ])).flat().sort((left, right) => left.localeCompare(right));

  return await Promise.all(files.map(async (target) => {
    const stat = await fs.stat(target);
    let content: Promise<string> | undefined;
    const readContent = async (): Promise<string> => {
      content ??= fs.readFile(target, "utf8");
      return await content;
    };
    const reference = relativeReference(repositoryRoot, target);
    return {
      path: reference,
      fingerprint: `${stat.mtimeMs}:${stat.size}`,
      readContent,
      readEmbeddingText: async () => embeddingTextForDocument({
        path: reference,
        content: await readContent(),
      }),
    };
  }));
}

export class NodeKnowledgeRepository {
  private readonly lexicalIndex: SqliteKnowledgeIndex;
  private readonly semantic?: SemanticSearchRuntime;

  constructor(
    readonly repositoryRoot: string,
    embedding?: { provider: EmbeddingProvider; minimumSimilarity: number },
  ) {
    this.lexicalIndex = new SqliteKnowledgeIndex(new NodeIndexStorage(
      path.join(repositoryRoot, indexDirectory, indexFile),
    ));
    this.semantic = embedding ? {
      provider: embedding.provider,
      minimumSimilarity: embedding.minimumSimilarity,
      index: new EmbeddingIndex(
        new NodeEmbeddingIndexStorage(path.join(repositoryRoot, indexDirectory, vectorIndexFile)),
        embedding.provider,
      ),
    } : undefined;
  }

  async search(query: string, version?: string): Promise<KnowledgeSearchResponse> {
    return await searchKnowledgeSources(
      await collectNodeKnowledgeSources(this.repositoryRoot),
      query,
      { lexicalIndex: this.lexicalIndex, semantic: this.semantic },
      version,
    );
  }

  async getById(id: string): Promise<ParsedKnowledgeDocument | undefined> {
    const matches: ParsedKnowledgeDocument[] = [];
    for (const source of await collectNodeKnowledgeSources(this.repositoryRoot)) {
      const document = parseKnowledgeDocument({
        path: source.path,
        content: await source.readContent(),
      });
      if (document.id === id) matches.push(document);
    }
    if (matches.length > 1) throw new Error(`Duplicate knowledge ID: ${id}`);
    return matches[0];
  }
}

export async function resolveRepositoryRoot(configuredRoot: string): Promise<string> {
  const root = await fs.realpath(configuredRoot);
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) throw new Error("Repository root is not a directory.");
  return root;
}
