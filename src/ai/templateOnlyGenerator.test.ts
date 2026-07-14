import assert from "node:assert/strict";
import test from "node:test";
import { TemplateOnlyGenerator } from "./templateOnlyGenerator";

test("creates an offline editable draft without inventing facts", async () => {
  const generator = new TemplateOnlyGenerator();
  const result = await generator.generate({ kind: "clipboard", text: "# 調査メモ\n確認中の内容" });

  assert.equal(result.title, "調査メモ");
  assert.equal(result.type, "investigation");
  assert.equal(result.summary, "");
  assert.deepEqual(result.content.verified, []);
});
