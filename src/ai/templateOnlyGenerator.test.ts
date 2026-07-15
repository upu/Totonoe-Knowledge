import assert from "node:assert/strict";
import test from "node:test";
import { TemplateOnlyGenerator } from "./templateOnlyGenerator";

test("creates an offline editable draft without inventing facts", async () => {
  const generator = new TemplateOnlyGenerator();
  const generation = await generator.generateWithOrigin({ kind: "clipboard", text: "# 調査メモ\n確認中の内容" });
  const result = generation.generated;

  assert.equal(generation.origin, "template");
  assert.equal(result.title, "調査メモ");
  assert.equal(result.type, "investigation");
  assert.equal(result.summary, "");
  assert.deepEqual(result.content.verified, []);
});

test("uses prepared metadata and sections without a model call", async () => {
  const generator = new TemplateOnlyGenerator();
  const generation = await generator.generateWithOrigin({
    kind: "selection",
    text: `---
prepared_knowledge: "1"
title: "構造化済み"
summary: "AIなしで読み込む"
type: procedure
keywords: ["offline", "dogfooding"]
---
# 結論
ローカルで読み込む。
# 背景
AIクレジットを使わない。
# 確認したこと
- front matterを解析した
# 対応方法
選択範囲から登録する。
# 注意点
- 内容は人が確認する
# 未解決事項
- なし`,
  });
  const result = generation.generated;

  assert.equal(generation.origin, "prepared");
  assert.equal(result.title, "構造化済み");
  assert.equal(result.summary, "AIなしで読み込む");
  assert.equal(result.type, "procedure");
  assert.deepEqual(result.keywords, ["offline", "dogfooding"]);
  assert.deepEqual(result.content.unresolved, ["なし"]);
});
