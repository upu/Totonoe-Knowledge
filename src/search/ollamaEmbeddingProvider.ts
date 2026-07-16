import { normalizeEmbedding, type EmbeddingProvider } from "./embeddingProvider";

interface EmbeddingHttpResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type EmbeddingFetch = (
  url: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<EmbeddingHttpResponse>;

export interface OllamaEmbeddingProviderOptions {
  endpoint?: string;
  model?: string;
  timeoutMs?: number;
  fetch?: EmbeddingFetch;
}

function validatedEndpoint(value: string): URL {
  const endpoint = new URL(value);
  const hostname = endpoint.hostname.toLocaleLowerCase();
  const isLoopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  if (endpoint.protocol !== "http:" || !isLoopback || endpoint.username || endpoint.password) {
    throw new Error("Ollama endpoint must be an unauthenticated HTTP loopback URL.");
  }
  endpoint.pathname = endpoint.pathname.replace(/\/+$/, "");
  endpoint.search = "";
  endpoint.hash = "";
  return endpoint;
}

const defaultFetch: EmbeddingFetch = async (url, init) => await fetch(url, init);

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly id = "ollama";
  readonly model: string;
  private readonly endpoint: URL;
  private readonly timeoutMs: number;
  private readonly fetch: EmbeddingFetch;

  constructor(options: OllamaEmbeddingProviderOptions = {}) {
    this.endpoint = validatedEndpoint(options.endpoint ?? "http://127.0.0.1:11434");
    this.model = options.model?.trim() || "embeddinggemma";
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetch = options.fetch ?? defaultFetch;
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    if (!texts.length) return [];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const embedUrl = new URL(this.endpoint.toString());
      embedUrl.pathname = `${embedUrl.pathname.replace(/\/+$/, "")}/api/embed`;
      const response = await this.fetch(embedUrl.toString(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: this.model, input: texts }),
        signal: controller.signal,
      });
      const body = await response.text();
      if (!response.ok) throw new Error(`Ollama embed request failed (${response.status}): ${body.slice(0, 200)}`);
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        throw new Error("Ollama returned invalid JSON.");
      }
      const embeddings = (parsed as { embeddings?: unknown }).embeddings;
      if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
        throw new Error("Ollama returned an unexpected embedding count.");
      }
      const normalized = embeddings.map((vector) => {
        if (!Array.isArray(vector) || vector.some((value) => typeof value !== "number")) {
          throw new Error("Ollama returned an invalid embedding vector.");
        }
        return normalizeEmbedding(vector as number[]);
      });
      const dimension = normalized[0]?.length;
      if (!dimension || normalized.some((vector) => vector.length !== dimension)) {
        throw new Error("Ollama returned inconsistent embedding dimensions.");
      }
      return normalized;
    } finally {
      clearTimeout(timeout);
    }
  }
}
