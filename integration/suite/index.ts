import assert from "node:assert/strict";
import * as vscode from "vscode";
import { findKnowledgeMarkdownFiles } from "../../src/knowledge/knowledgeFiles";
import { KnowledgeRepositoryLocator } from "../../src/knowledge/repositoryLocation";
import {
  knowledgeIndexUri,
  rebuildWorkspaceKnowledgeIndex,
  searchWorkspaceKnowledge,
} from "../../src/search/workspaceSearch";

class TestMemento implements vscode.Memento {
  private readonly values = new Map<string, unknown>();

  constructor(initial: Record<string, unknown> = {}) {
    for (const [key, value] of Object.entries(initial)) this.values.set(key, value);
  }

  keys(): readonly string[] {
    return [...this.values.keys()];
  }

  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  get<T>(key: string, defaultValue?: T): T | undefined {
    return (this.values.has(key) ? this.values.get(key) : defaultValue) as T | undefined;
  }

  update(key: string, value: unknown): Promise<void> {
    if (value === undefined) this.values.delete(key);
    else this.values.set(key, value);
    return Promise.resolve();
  }
}

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
    "totonoeKnowledge.selectRepository",
    "totonoeKnowledge.showRepository",
    "totonoeKnowledge.useWorkspaceRepository",
    "totonoeKnowledge.search",
    "totonoeKnowledge.searchForVersion",
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

  const workspaceLocation = await new KnowledgeRepositoryLocator(new TestMemento()).resolve();
  assert.equal(workspaceLocation.kind, "workspace", "workspace repository should remain the fallback");
  assert.equal(
    workspaceLocation.repositoryRoot.toString(),
    vscode.Uri.joinPath(root, "knowledge").toString(),
    "repositoryPath should remain compatible when no external folder is selected",
  );

  const externalRoot = vscode.Uri.joinPath(root, "..", "external-knowledge-test");
  const externalState = new TestMemento({
    "totonoeKnowledge.repositorySelection": { version: 1, uri: externalRoot.toString() },
  });
  const externalLocator = new KnowledgeRepositoryLocator(externalState);
  try {
    await vscode.workspace.fs.delete(externalRoot, { recursive: true, useTrash: false });
  } catch (error) {
    if (!(error instanceof vscode.FileSystemError) || error.code !== "FileNotFound") throw error;
  }
  try {
    const externalEntry = vscode.Uri.joinPath(externalRoot, "investigations", "external.md");
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(externalRoot, "investigations"));
    await vscode.workspace.fs.writeFile(
      externalEntry,
      await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, "knowledge", "investigations", "valid.md")),
    );
    const legacyRootEntry = vscode.Uri.joinPath(externalRoot, "Untitled-1.md");
    const legacyContent = Buffer.from(await vscode.workspace.fs.readFile(externalEntry))
      .toString("utf8")
      .replace("K-20260715-120000000-test", "K-20260715-120000000-legacy")
      .replace('title: "Integration test knowledge"', 'title: "Legacy root knowledge"')
      .replace('status: active', 'status: active\napplies_from: "17.1"\napplies_to: "17.9"')
      .replace('  - "integration-test"', '  - "legacy-root"');
    await vscode.workspace.fs.writeFile(legacyRootEntry, Buffer.from(legacyContent, "utf8"));
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(externalRoot, "README.md"),
      Buffer.from("# This repository README is not a knowledge entry.\n", "utf8"),
    );

    const externalLocation = await externalLocator.resolve();
    assert.equal(externalLocation.kind, "external", "explicit selection should override the workspace fallback");
    assert.equal(externalLocation.repositoryRoot.toString(), externalRoot.toString());
    assert.equal(externalLocation.indexRoot.toString(), externalRoot.toString());

    const externalFiles = await findKnowledgeMarkdownFiles(externalRoot);
    assert.deepEqual(
      new Set(externalFiles.map((uri) => uri.toString())),
      new Set([externalEntry.toString(), legacyRootEntry.toString()]),
      "type-directory and legacy root entries should be included while README is ignored",
    );
    const sync = await rebuildWorkspaceKnowledgeIndex(externalRoot, externalRoot);
    assert.equal(sync.added + sync.updated + sync.unchanged, 2, "external entries should be indexed");
    assert.ok(
      (await vscode.workspace.fs.stat(knowledgeIndexUri(externalRoot))).size > 0,
      "external repository should own its disposable index",
    );
    const search = await searchWorkspaceKnowledge(externalRoot, externalRoot, "legacy-root");
    assert.equal(search.results[0]?.path, "Untitled-1.md");
    assert.equal(
      (await searchWorkspaceKnowledge(externalRoot, externalRoot, "legacy-root", "17.0")).results.length,
      0,
      "versioned search should exclude entries before applies_from",
    );
    assert.equal(
      (await searchWorkspaceKnowledge(externalRoot, externalRoot, "legacy-root", "17.1")).results[0]?.path,
      "Untitled-1.md",
      "versioned search should include the applies_from boundary",
    );
  } finally {
    await vscode.workspace.fs.delete(externalRoot, { recursive: true, useTrash: false });
  }
  await assert.rejects(
    () => externalLocator.resolve(),
    /選択したナレッジリポジトリへアクセスできません/,
    "missing external repositories should not silently fall back to the workspace",
  );
  await externalLocator.useWorkspaceRepository();
  assert.equal(
    (await externalLocator.resolve()).kind,
    "workspace",
    "explicit reset should restore the workspace repository",
  );

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
  const validUri = vscode.Uri.joinPath(root, "knowledge", "investigations", "valid.md");
  const invalidUri = vscode.Uri.joinPath(root, "knowledge", "investigations", "invalid.md");
  assert.deepEqual(vscode.languages.getDiagnostics(validUri), [], "valid fixture should have no diagnostics");
  assert.ok(
    vscode.languages.getDiagnostics(invalidUri).some((diagnostic) => diagnostic.code === "missing-frontmatter"),
    "invalid fixture should publish a missing-frontmatter diagnostic",
  );
}
