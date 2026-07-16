export interface EmbeddingProvider {
  readonly id: string;
  readonly model: string;
  embed(texts: readonly string[]): Promise<number[][]>;
}

export function embeddingProviderKey(provider: EmbeddingProvider): string {
  return `${provider.id}:${provider.model}`;
}

export function normalizeEmbedding(vector: readonly number[]): number[] {
  if (!vector.length || vector.some((value) => !Number.isFinite(value))) {
    throw new Error("Embedding vectors must contain finite numbers.");
  }
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(magnitude) || magnitude === 0) {
    throw new Error("Embedding vectors must have a non-zero magnitude.");
  }
  return vector.map((value) => value / magnitude);
}

export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length || !left.length) {
    throw new Error("Embedding vectors must have the same non-zero dimension.");
  }
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}
