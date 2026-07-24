import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { frontmatterString, parseFrontmatter } from "../knowledge/frontmatter";
import { persistDraft, type DraftSaveResult } from "../knowledge/draftSave";
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
  try {
    const stat = await fs.lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
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

function registrationTargetPath(repositoryRoot: string, reference: string): string {
  const normalized = reference.replaceAll("\\", "/");
  if (
    !normalized
    || path.isAbsolute(reference)
    || normalized.startsWith("/")
    || normalized.split("/").includes("..")
  ) {
    throw new Error("Repository相対の登録先を作成できませんでした。");
  }
  const target = path.resolve(repositoryRoot, ...normalized.split("/"));
  const relative = path.relative(repositoryRoot, target);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Repository相対の登録先を作成できませんでした。");
  }
  return target;
}

async function assertSafeRegistrationParent(
  repositoryRoot: string,
  target: string,
): Promise<void> {
  const relativeParent = path.relative(repositoryRoot, path.dirname(target));
  let current = repositoryRoot;
  for (const segment of relativeParent.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error("登録先ディレクトリにsymbolic linkまたは非directoryがあります。");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
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

  async registrationStateFingerprint(): Promise<string> {
    const hash = createHash("sha256");
    for (const source of await collectNodeKnowledgeSources(this.repositoryRoot)) {
      const content = await source.readContent();
      hash.update(`${Buffer.byteLength(source.path, "utf8")}:`);
      hash.update(source.path, "utf8");
      hash.update(`${Buffer.byteLength(content, "utf8")}:`);
      hash.update(content, "utf8");
    }
    return hash.digest("hex");
  }

  async registrationTargetExists(reference: string): Promise<boolean> {
    const target = registrationTargetPath(this.repositoryRoot, reference);
    await assertSafeRegistrationParent(this.repositoryRoot, target);
    try {
      await fs.lstat(target);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  async saveRegistration(
    reference: string,
    markdown: string,
  ): Promise<DraftSaveResult> {
    const target = registrationTargetPath(this.repositoryRoot, reference);
    await assertSafeRegistrationParent(this.repositoryRoot, target);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await assertSafeRegistrationParent(this.repositoryRoot, target);

    return await persistDraft({
      targetExists: () => this.registrationTargetExists(reference),
      save: async () => {
        let handle;
        try {
          handle = await fs.open(target, "wx");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST") return "conflict";
          throw error;
        }

        let failure: unknown;
        try {
          await handle.writeFile(markdown, "utf8");
          await handle.sync();
        } catch (error) {
          failure = error;
        }
        try {
          await handle.close();
        } catch (error) {
          failure ??= error;
        }
        if (failure !== undefined) {
          try {
            await fs.rm(target, { force: true });
          } catch {
            // Preserve the original write or close failure.
          }
          throw failure;
        }
        return true;
      },
    });
  }
}

export async function resolveRepositoryRoot(configuredRoot: string): Promise<string> {
  const root = await fs.realpath(configuredRoot);
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) throw new Error("Repository root is not a directory.");
  return root;
}
