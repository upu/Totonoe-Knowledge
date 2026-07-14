import assert from "node:assert/strict";
import test from "node:test";
import { parseLanguageModelResponse } from "./languageModelResponse";

const validResponse = {
  title: "PTY幅を変更する方法",
  summary: "COLUMNSではなくsttyでPTY幅を変更する",
  type: "investigation",
  keywords: ["PTY", "stty"],
  content: {
    conclusion: "stty colsを使用する。",
    background: "ログが80文字で折り返された。",
    verified: ["COLUMNSだけでは改善しなかった。"],
    procedure: "stty cols 200を実行する。",
    cautions: ["接続ごとに確認する。"],
    unresolved: [],
  },
};

test("parses a JSON object and an optional markdown fence", () => {
  assert.deepEqual(parseLanguageModelResponse(JSON.stringify(validResponse)), validResponse);
  assert.deepEqual(
    parseLanguageModelResponse(`\`\`\`json\n${JSON.stringify(validResponse)}\n\`\`\``),
    validResponse,
  );
});

test("rejects unsupported types and malformed fields", () => {
  assert.throws(
    () => parseLanguageModelResponse(JSON.stringify({ ...validResponse, type: "memo" })),
    /未対応のナレッジ種別/,
  );
  assert.throws(
    () => parseLanguageModelResponse(JSON.stringify({ ...validResponse, keywords: "PTY" })),
    /文字列配列/,
  );
});

test("rejects prose around the JSON response", () => {
  assert.throws(() => parseLanguageModelResponse(`結果です。\n${JSON.stringify(validResponse)}`), /JSONとして解析/);
});
