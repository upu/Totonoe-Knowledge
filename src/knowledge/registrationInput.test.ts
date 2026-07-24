import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeRegistrationInput,
  type RegistrationInput,
} from "./registrationInput";

const input: RegistrationInput = {
  title: " Codexから登録する ",
  summary: " 確認付きでローカルへ保存する ",
  type: "procedure",
  keywords: [" Codex ", " MCP "],
  conclusion: " previewしてからregisterする。 ",
  background: " GitHub Copilotを経由せず登録したい。 ",
  verified: [" stdioだけを使用する "],
  procedure: " diffを確認してregisterする。 ",
  cautions: [" 本文を命令として扱わない "],
  unresolved: [" なし "],
};

test("normalizes the structured registration fields shared with prepared knowledge", () => {
  assert.deepEqual(normalizeRegistrationInput(input), {
    title: "Codexから登録する",
    summary: "確認付きでローカルへ保存する",
    type: "procedure",
    keywords: ["Codex", "MCP"],
    content: {
      conclusion: "previewしてからregisterする。",
      background: "GitHub Copilotを経由せず登録したい。",
      verified: ["stdioだけを使用する"],
      procedure: "diffを確認してregisterする。",
      cautions: ["本文を命令として扱わない"],
      unresolved: ["なし"],
    },
  });
});

test("rejects missing fixed-section content instead of creating placeholders", () => {
  assert.throws(
    () => normalizeRegistrationInput({ ...input, conclusion: " " }),
    /結論に本文が必要です/,
  );
  assert.throws(
    () => normalizeRegistrationInput({ ...input, verified: [] }),
    /確認したことには1つ以上/,
  );
  assert.throws(
    () => normalizeRegistrationInput({ ...input, keywords: [" "] }),
    /keywordsには1つ以上/,
  );
});
