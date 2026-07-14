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
    "totonoeKnowledge.registerFromClipboardWithAi",
    "totonoeKnowledge.registerFromClipboardWithTemplate",
    "totonoeKnowledge.registerSelectionWithAi",
    "totonoeKnowledge.registerSelectionWithTemplate",
    "totonoeKnowledge.search",
    "totonoeKnowledge.validateRepository",
    "totonoeKnowledge.rebuildSearchIndex",
  ]) {
    assert.ok(commands.includes(command), `command should be registered: ${command}`);
  }

  const toolNames = vscode.lm.tools.map((tool) => tool.name);
  assert.ok(toolNames.includes("totonoe-knowledge_saveKnowledge"), "save tool should be registered");
  assert.ok(toolNames.includes("totonoe-knowledge_searchKnowledge"), "search tool should be registered");

  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  assert.ok(root, "fixture workspace should be open");

  const draftTarget = vscode.Uri.joinPath(root, ".totonoe", "path-bound-draft-test.md");
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(root, ".totonoe"));
  try {
    await vscode.workspace.fs.delete(draftTarget);
  } catch (error) {
    if (!(error instanceof vscode.FileSystemError) || error.code !== "FileNotFound") throw error;
  }
  const draftUri = draftTarget.with({ scheme: "untitled" });
  const draftDocument = await vscode.workspace.openTextDocument(draftUri);
  const edit = new vscode.WorkspaceEdit();
  edit.insert(draftUri, new vscode.Position(0, 0), "# path-bound draft\n");
  assert.equal(await vscode.workspace.applyEdit(edit), true, "draft content should be applied");
  assert.equal(await draftDocument.save(), true, "Ctrl+S equivalent should save to the associated path");
  assert.equal(
    Buffer.from(await vscode.workspace.fs.readFile(draftTarget)).toString("utf8").replaceAll("\r\n", "\n"),
    "# path-bound draft\n",
    "associated untitled draft should save to its precomputed Markdown path",
  );
  await vscode.workspace.fs.delete(draftTarget);

  await vscode.commands.executeCommand("totonoeKnowledge.rebuildSearchIndex");
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
