import assert from "node:assert/strict";
import test from "node:test";
import { EmbeddingIndex, type EmbeddingIndexSource, type EmbeddingIndexStorage } from "./embeddingIndex";
import type { EmbeddingProvider } from "./embeddingProvider";

class MemoryStorage implements EmbeddingIndexStorage {
  data: string | undefined;
  async read(): Promise<string | undefined> { return this.data; }
  async write(data: string): Promise<void> { this.data = data; }
}

class FakeProvider implements EmbeddingProvider {
  readonly id = "fake";
  calls: string[][] = [];
  constructor(readonly model: string) {}
  async embed(texts: readonly string[]): Promise<number[][]> {
    this.calls.push([...texts]);
    return texts.map((text) => text.startsWith("a") ? [3, 4] : [0, 2]);
  }
}

function source(path: string, fingerprint: string, text: string): EmbeddingIndexSource {
  return { path, fingerprint, readEmbeddingText: async () => text };
}

test("incrementally embeds only added and changed documents and removes deleted entries", async () => {
  const storage = new MemoryStorage();
  const provider = new FakeProvider("one");
  const index = new EmbeddingIndex(storage, provider);
  const alpha = source("alpha.md", "1", "alpha");
  const beta = source("beta.md", "1", "beta");

  const first = await index.sync([alpha, beta]);
  assert.equal(first.added, 2);
  assert.deepEqual(provider.calls, [["alpha", "beta"]]);
  assert.deepEqual(first.vectors.get("alpha.md"), [0.6, 0.8]);

  const unchanged = await index.sync([alpha, beta]);
  assert.equal(unchanged.unchanged, 2);
  assert.equal(provider.calls.length, 1);

  const updated = await index.sync([source("alpha.md", "2", "alpha changed")]);
  assert.equal(updated.updated, 1);
  assert.equal(updated.removed, 1);
  assert.deepEqual(provider.calls[1], ["alpha changed"]);
  assert.equal(updated.vectors.has("beta.md"), false);

  const persisted = JSON.parse(storage.data ?? "") as { entries: Record<string, unknown> };
  assert.deepEqual(Object.keys(persisted.entries), ["alpha.md"]);
  assert.doesNotMatch(storage.data ?? "", /alpha changed/);
});

test("rebuilds a corrupt cache or a cache created by another model", async () => {
  const storage = new MemoryStorage();
  storage.data = "not-json";
  const firstProvider = new FakeProvider("one");
  const rebuilt = await new EmbeddingIndex(storage, firstProvider).sync([source("alpha.md", "1", "alpha")]);
  assert.equal(rebuilt.rebuilt, true);
  assert.equal(rebuilt.added, 1);

  const secondProvider = new FakeProvider("two");
  const changedModel = await new EmbeddingIndex(storage, secondProvider).sync([source("alpha.md", "1", "alpha")]);
  assert.equal(changedModel.rebuilt, true);
  assert.equal(changedModel.added, 1);
  assert.equal(secondProvider.calls.length, 1);
});
