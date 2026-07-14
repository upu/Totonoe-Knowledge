import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

interface ToolContribution {
  name: string;
  toolReferenceName?: string;
  canBeReferencedInPrompt?: boolean;
  inputSchema?: { required?: string[] };
}

test("contributes explicit save and search language model tools", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8")) as {
    contributes?: { languageModelTools?: ToolContribution[] };
  };
  const tools = manifest.contributes?.languageModelTools ?? [];
  const save = tools.find((tool) => tool.name === "totonoe-knowledge_saveKnowledge");
  const search = tools.find((tool) => tool.name === "totonoe-knowledge_searchKnowledge");

  assert.equal(save?.toolReferenceName, "totonoeKnowledgeSave");
  assert.equal(save?.canBeReferencedInPrompt, true);
  assert.ok(save?.inputSchema?.required?.includes("title"));
  assert.equal(search?.toolReferenceName, "totonoeKnowledgeSearch");
  assert.equal(search?.canBeReferencedInPrompt, true);
  assert.ok(search?.inputSchema?.required?.includes("query"));
});
