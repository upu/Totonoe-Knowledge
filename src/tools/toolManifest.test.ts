import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

interface ToolContribution {
  name: string;
  toolReferenceName?: string;
  canBeReferencedInPrompt?: boolean;
  inputSchema?: {
    required?: string[];
    properties?: Record<string, unknown>;
  };
}

test("contributes explicit save and search language model tools", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8")) as {
    capabilities?: { untrustedWorkspaces?: { supported?: boolean } };
    contributes?: {
      commands?: Array<{ command: string; title: string }>;
      menus?: { "editor/title"?: Array<{ command: string; when?: string }> };
      languageModelTools?: ToolContribution[];
    };
  };
  const tools = manifest.contributes?.languageModelTools ?? [];
  const save = tools.find((tool) => tool.name === "totonoe-knowledge_saveKnowledge");
  const search = tools.find((tool) => tool.name === "totonoe-knowledge_searchKnowledge");

  assert.equal(save?.toolReferenceName, "totonoeKnowledgeSave");
  assert.equal(save?.canBeReferencedInPrompt, true);
  assert.ok(save?.inputSchema?.required?.includes("title"));
  assert.ok(save?.inputSchema?.properties?.appliesFrom);
  assert.ok(save?.inputSchema?.properties?.appliesTo);
  assert.equal(search?.toolReferenceName, "totonoeKnowledgeSearch");
  assert.equal(search?.canBeReferencedInPrompt, true);
  assert.ok(search?.inputSchema?.required?.includes("query"));
  assert.ok(search?.inputSchema?.properties?.version);
  assert.equal(manifest.capabilities?.untrustedWorkspaces?.supported, false);

  const commands = new Set(manifest.contributes?.commands?.map((command) => command.command));
  for (const command of [
    "totonoeKnowledge.registerFromClipboardWithAi",
    "totonoeKnowledge.registerFromClipboardWithTemplate",
    "totonoeKnowledge.registerSelectionWithAi",
    "totonoeKnowledge.registerSelectionWithTemplate",
    "totonoeKnowledge.selectRepository",
    "totonoeKnowledge.showRepository",
    "totonoeKnowledge.useWorkspaceRepository",
    "totonoeKnowledge.searchForVersion",
    "totonoeKnowledge.saveDraft",
  ]) {
    assert.ok(commands.has(command), `command should be contributed: ${command}`);
  }
  assert.ok(
    manifest.contributes?.menus?.["editor/title"]?.some((item) =>
      item.command === "totonoeKnowledge.saveDraft" && item.when?.includes("resourceScheme == untitled"),
    ),
    "the explicit registration action should remain available in the preview editor title",
  );
  for (const command of [
    "totonoeKnowledge.registerFromClipboardWithTemplate",
    "totonoeKnowledge.registerSelectionWithTemplate",
  ]) {
    assert.match(
      manifest.contributes?.commands?.find((candidate) => candidate.command === command)?.title ?? "",
      /AIを使わず/,
    );
  }
});
