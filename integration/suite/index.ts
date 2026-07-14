import assert from "node:assert/strict";
import * as vscode from "vscode";

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension("totonoe.totonoe-knowledge");
  assert.ok(extension, "Totonoe Knowledge extension should be installed in the test host");
  await extension.activate();
  assert.equal(extension.isActive, true, "extension should activate without errors");

  const commands = await vscode.commands.getCommands(true);
  for (const command of [
    "totonoeKnowledge.registerFromClipboard",
    "totonoeKnowledge.registerSelection",
    "totonoeKnowledge.search",
    "totonoeKnowledge.validateRepository",
    "totonoeKnowledge.rebuildSearchIndex",
  ]) {
    assert.ok(commands.includes(command), `command should be registered: ${command}`);
  }

  const toolNames = vscode.lm.tools.map((tool) => tool.name);
  assert.ok(toolNames.includes("totonoe-knowledge_saveKnowledge"), "save tool should be registered");
  assert.ok(toolNames.includes("totonoe-knowledge_searchKnowledge"), "search tool should be registered");

  await vscode.commands.executeCommand("totonoeKnowledge.rebuildSearchIndex");
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  assert.ok(root, "fixture workspace should be open");
  const indexUri = vscode.Uri.joinPath(root, ".totonoe", "index.sqlite");
  const indexStat = await vscode.workspace.fs.stat(indexUri);
  assert.ok(indexStat.size > 0, "rebuild command should create a non-empty SQLite index");
  const indexHeader = Buffer.from(await vscode.workspace.fs.readFile(indexUri))
    .subarray(0, 16)
    .toString("utf8");
  assert.equal(indexHeader, "SQLite format 3\0", "search index should be a SQLite database");

  await vscode.commands.executeCommand("totonoeKnowledge.validateRepository");
  const validUri = vscode.Uri.joinPath(root, "knowledge", "valid.md");
  const invalidUri = vscode.Uri.joinPath(root, "knowledge", "invalid.md");
  assert.deepEqual(vscode.languages.getDiagnostics(validUri), [], "valid fixture should have no diagnostics");
  assert.ok(
    vscode.languages.getDiagnostics(invalidUri).some((diagnostic) => diagnostic.code === "missing-frontmatter"),
    "invalid fixture should publish a missing-frontmatter diagnostic",
  );
}
