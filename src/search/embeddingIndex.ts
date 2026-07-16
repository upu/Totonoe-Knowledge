import {
  embeddingProviderKey,
  normalizeEmbedding,
  type EmbeddingProvider,
} from "./embeddingProvider";

const cacheVersion = 1;
const batchSize = 16;

export interface EmbeddingIndexStorage {
  read(): Promise<string | undefined>;
  write(data: string): Promise<void>;
}

export interface EmbeddingIndexSource {
  path: string;
  fingerprint: string;
  readEmbeddingText(): Promise<string>;
}

interface CachedEntry {
  fingerprint: string;
  vector: number[];
}

interface CachedEmbeddingIndex {
  version: number;
  provider: string;
  entries: Record<string, CachedEntry>;
}

export interface EmbeddingIndexSyncResult {
  vectors: Map<string, number[]>;
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
  rebuilt: boolean;
  provider: string;
}

function emptyCache(provider: string): CachedEmbeddingIndex {
  return { version: cacheVersion, provider, entries: {} };
}

function readCache(data: string | undefined, provider: string): { cache: CachedEmbeddingIndex; rebuilt: boolean } {
  if (!data) return { cache: emptyCache(provider), rebuilt: false };
  try {
    const parsed = JSON.parse(data) as Partial<CachedEmbeddingIndex>;
    if (parsed.version !== cacheVersion || parsed.provider !== provider || !parsed.entries) {
      return { cache: emptyCache(provider), rebuilt: true };
    }
    for (const entry of Object.values(parsed.entries)) entry.vector = normalizeEmbedding(entry.vector);
    return { cache: parsed as CachedEmbeddingIndex, rebuilt: false };
  } catch {
    return { cache: emptyCache(provider), rebuilt: true };
  }
}

export class EmbeddingIndex {
  private pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: EmbeddingIndexStorage,
    private readonly provider: EmbeddingProvider,
  ) {}

  sync(sources: readonly EmbeddingIndexSource[], forceRebuild = false): Promise<EmbeddingIndexSyncResult> {
    return this.exclusive(async () => {
      const provider = embeddingProviderKey(this.provider);
      const stored = forceRebuild ? undefined : await this.storage.read();
      const opened = forceRebuild
        ? { cache: emptyCache(provider), rebuilt: true }
        : readCache(stored, provider);
      const cache = opened.cache;
      const sourcePaths = new Set(sources.map((source) => source.path));
      let removed = 0;
      for (const path of Object.keys(cache.entries)) {
        if (!sourcePaths.has(path)) {
          delete cache.entries[path];
          removed += 1;
        }
      }

      const changed = sources.filter((source) => cache.entries[source.path]?.fingerprint !== source.fingerprint);
      let added = 0;
      let updated = 0;
      for (let offset = 0; offset < changed.length; offset += batchSize) {
        const batch = changed.slice(offset, offset + batchSize);
        const vectors = await this.provider.embed(await Promise.all(batch.map((source) => source.readEmbeddingText())));
        if (vectors.length !== batch.length) throw new Error("Embedding provider returned an unexpected vector count.");
        for (let index = 0; index < batch.length; index += 1) {
          const source = batch[index];
          const existed = cache.entries[source.path] !== undefined;
          cache.entries[source.path] = {
            fingerprint: source.fingerprint,
            vector: normalizeEmbedding(vectors[index]),
          };
          if (existed) updated += 1;
          else added += 1;
        }
      }

      if (changed.length || removed || opened.rebuilt || forceRebuild || !stored) {
        await this.storage.write(JSON.stringify(cache));
      }
      return {
        vectors: new Map(Object.entries(cache.entries).map(([path, entry]) => [path, entry.vector])),
        added,
        updated,
        removed,
        unchanged: sources.length - changed.length,
        rebuilt: opened.rebuilt,
        provider,
      };
    });
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation, operation);
    this.pending = result.then(() => undefined, () => undefined);
    return result;
  }
}
