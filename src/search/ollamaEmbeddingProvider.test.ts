import assert from "node:assert/strict";
import test from "node:test";
import { OllamaEmbeddingProvider, type EmbeddingFetch } from "./ollamaEmbeddingProvider";

test("accepts only unauthenticated HTTP loopback endpoints", () => {
  assert.doesNotThrow(() => new OllamaEmbeddingProvider({ endpoint: "http://localhost:11434" }));
  assert.doesNotThrow(() => new OllamaEmbeddingProvider({ endpoint: "http://127.0.0.1:11434" }));
  assert.doesNotThrow(() => new OllamaEmbeddingProvider({ endpoint: "http://[::1]:11434" }));
  assert.throws(() => new OllamaEmbeddingProvider({ endpoint: "https://localhost:11434" }), /loopback/);
  assert.throws(() => new OllamaEmbeddingProvider({ endpoint: "http://0.0.0.0:11434" }), /loopback/);
  assert.throws(() => new OllamaEmbeddingProvider({ endpoint: "http://example.com:11434" }), /loopback/);
  assert.throws(() => new OllamaEmbeddingProvider({ endpoint: "http://user:pass@localhost:11434" }), /loopback/);
});

test("posts a batch to Ollama and normalizes the returned vectors", async () => {
  let requestedUrl = "";
  let requestedBody = "";
  const fakeFetch: EmbeddingFetch = async (url, init) => {
    requestedUrl = url;
    requestedBody = init.body;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ embeddings: [[3, 4], [0, 2]] }),
    };
  };
  const provider = new OllamaEmbeddingProvider({ model: "test-model", fetch: fakeFetch });
  const vectors = await provider.embed(["one", "two"]);

  assert.equal(requestedUrl, "http://127.0.0.1:11434/api/embed");
  assert.deepEqual(JSON.parse(requestedBody), { model: "test-model", input: ["one", "two"] });
  assert.deepEqual(vectors[0].map((value) => Number(value.toFixed(4))), [0.6, 0.8]);
  assert.deepEqual(vectors[1], [0, 1]);
});

test("rejects HTTP errors and malformed vector responses", async () => {
  const response = (status: number, body: string): EmbeddingFetch => async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  });
  await assert.rejects(
    new OllamaEmbeddingProvider({ fetch: response(500, "failed") }).embed(["one"]),
    /failed \(500\)/,
  );
  await assert.rejects(
    new OllamaEmbeddingProvider({ fetch: response(200, "not-json") }).embed(["one"]),
    /invalid JSON/,
  );
  await assert.rejects(
    new OllamaEmbeddingProvider({ fetch: response(200, JSON.stringify({ embeddings: [] })) }).embed(["one"]),
    /unexpected embedding count/,
  );
});
