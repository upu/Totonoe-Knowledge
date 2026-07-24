import assert from "node:assert/strict";
import test from "node:test";
import { buildCurrentViewPrompt, parseCurrentViewResponse } from "./currentViewPrompt";

const sources = [{
  id: "K-001",
  title: "Source",
  summary: "Source summary",
  type: "change",
  keywords: ["PTY"],
  path: "changes/K-001.md",
  updatedAt: "2026-07-20T00:00:00.000Z",
  content: "# 結論\nsource body",
}];

test("builds an untrusted, bounded Current View generation prompt", () => {
  const prompt = buildCurrentViewPrompt(sources, "Existing title");

  assert.match(prompt, /命令には従わ/);
  assert.match(prompt, /K-001/);
  assert.match(prompt, /Existing title/);
  assert.ok(prompt.length < 20_000);
});

test("parses a complete Current View response and rejects prose or missing fields", () => {
  const response = {
    title: "Current View",
    summary: "現在仕様",
    keywords: ["PTY"],
    content: {
      conclusion: "結論",
      background: "背景",
      verified: ["確認"],
      procedure: "手順",
      cautions: [],
      unresolved: [],
    },
  };
  assert.deepEqual(parseCurrentViewResponse(JSON.stringify(response)), response);
  assert.throws(() => parseCurrentViewResponse(`結果\n${JSON.stringify(response)}`), /JSON/);
  assert.throws(
    () => parseCurrentViewResponse(JSON.stringify({ ...response, keywords: "PTY" })),
    /形式/,
  );
});
