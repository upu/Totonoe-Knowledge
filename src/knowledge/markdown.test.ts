import assert from "node:assert/strict";
import test from "node:test";
import { renderKnowledge, slugify } from "./markdown";
import type { KnowledgeDraft } from "./types";

const draft: KnowledgeDraft = {
  id: "K-20260715-001",
  title: "PTY幅の調査",
  summary: "sttyで端末幅を変更する",
  type: "investigation",
  keywords: ["PTY", "stty"],
  createdAt: "2026-07-15T00:00:00.000Z",
  source: "# 元の見出し\n確認した入力",
  content: {
    conclusion: "sttyを使用する。",
    background: "ログが折り返された。",
    verified: ["COLUMNSだけでは変わらない。"],
    procedure: "stty cols 200",
    cautions: ["接続ごとに確認する。"],
    unresolved: [],
  },
};

test("renders generated sections and quotes the untrusted source", () => {
  const markdown = renderKnowledge(draft);
  assert.match(markdown, /title: "PTY幅の調査"/);
  assert.match(markdown, /# 結論\n\nsttyを使用する。/);
  assert.match(markdown, /> # 元の見出し\n> 確認した入力/);
});

test("creates a stable unicode slug", () => {
  assert.equal(slugify("PTY 幅の調査!"), "pty-幅の調査");
});
