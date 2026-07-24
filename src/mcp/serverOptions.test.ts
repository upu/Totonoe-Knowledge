import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";
import { parseServerOptions } from "./serverOptions";

test("requires repository root as a startup argument", () => {
  assert.throws(() => parseServerOptions([], "C:\\workspace"), /--repository/);
});

test("resolves repository root once at startup and keeps embedding disabled by default", () => {
  const options = parseServerOptions(["--repository", "knowledge"], "C:\\workspace");

  assert.equal(options.repositoryRoot, path.resolve("C:\\workspace", "knowledge"));
  assert.equal(options.embeddingProvider, "disabled");
  assert.equal(options.minimumSimilarity, -1);
});

test("accepts bounded Ollama startup settings but rejects unknown arguments", () => {
  const options = parseServerOptions([
    "--repository", "knowledge",
    "--embedding-provider", "ollama",
    "--ollama-endpoint", "http://127.0.0.1:11434",
    "--ollama-model", "embeddinggemma",
    "--minimum-similarity", "0.4",
  ], "C:\\workspace");

  assert.equal(options.embeddingProvider, "ollama");
  assert.equal(options.minimumSimilarity, 0.4);
  assert.throws(
    () => parseServerOptions(["--repository", "knowledge", "--path", "other"], "C:\\workspace"),
    /不明な引数/,
  );
});
