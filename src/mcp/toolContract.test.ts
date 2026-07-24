import assert from "node:assert/strict";
import test from "node:test";
import type { KnowledgeSearchResult } from "../search/searchEngine";
import {
  MCP_UNTRUSTED_NOTICE,
  formatGetResponse,
  formatSearchResponse,
  maxGetResponseBytes,
} from "./toolContract";

function searchResult(overrides: Partial<KnowledgeSearchResult> = {}): KnowledgeSearchResult {
  return {
    path: "investigations/example.md",
    content: "secret source content",
    id: "K-20260724-120000000-example",
    title: "Example",
    summary: "A concise summary",
    type: "investigation",
    status: "active",
    appliesFrom: "1.0",
    appliesTo: "2.0",
    supersedes: [],
    keywords: ["secret-keyword"],
    body: "secret body",
    score: 42,
    matchedTerms: ["example"],
    scoreBreakdown: {
      fullText: 30,
      metadata: 12,
      semantic: 0,
      reasons: ["全文=30.00", "metadata=12.00"],
    },
    ...overrides,
  };
}

test("search response exposes only the documented allowlist and fixed notice", () => {
  const response = formatSearchResponse({
    results: [searchResult()],
    backend: "sqlite",
  }, 5);

  assert.equal(response.notice, MCP_UNTRUSTED_NOTICE);
  assert.deepEqual(Object.keys(response.items[0] ?? {}).sort(), [
    "appliesFrom",
    "appliesTo",
    "id",
    "reference",
    "score",
    "scoreReasons",
    "status",
    "summary",
    "title",
    "type",
  ]);
  assert.equal(JSON.stringify(response).includes("secret source content"), false);
  assert.equal(JSON.stringify(response).includes("secret body"), false);
  assert.equal(JSON.stringify(response).includes("secret-keyword"), false);
  assert.equal(response.items[0]?.reference, "investigations/example.md");
});

test("search response bounds the result count and summary size", () => {
  const response = formatSearchResponse({
    results: Array.from({ length: 12 }, (_, index) => searchResult({
      id: `K-${index}`,
      summary: "あ".repeat(600),
    })),
    backend: "scan",
  }, 50);

  assert.equal(response.items.length, 10);
  assert.equal(Array.from(response.items[0]?.summary ?? "").length, 480);
});

test("search response rejects references that escape the configured repository", () => {
  assert.throws(
    () => formatSearchResponse({
      results: [searchResult({ path: "investigations/../../outside.md" })],
      backend: "scan",
    }, 1),
    /Repository相対参照/,
  );
});

test("get response returns one entry by ID without an absolute path", () => {
  const response = formatGetResponse(searchResult());

  assert.equal(response.notice, MCP_UNTRUSTED_NOTICE);
  assert.deepEqual(Object.keys(response.item).sort(), [
    "appliesFrom",
    "appliesTo",
    "content",
    "id",
    "reference",
    "status",
    "summary",
    "title",
    "type",
  ]);
  assert.equal(response.item.reference, "investigations/example.md");
  assert.equal(response.item.content, "secret body");
});

test("get response rejects an oversized entry instead of returning partial Markdown", () => {
  assert.throws(
    () => formatGetResponse(searchResult({ body: "x".repeat(maxGetResponseBytes) })),
    /応答上限/,
  );
});
