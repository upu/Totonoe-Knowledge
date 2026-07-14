import * as vscode from "vscode";
import { isValidRepositoryPath } from "../knowledge/repositoryPath";
import { validateKnowledgeDocuments } from "../validation/knowledgeValidator";

interface LoadedDocument {
  path: string;
  content: string;
  uri: vscode.Uri;
}

export async function validateKnowledgeRepository(
  collection: vscode.DiagnosticCollection,
): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) {
    void vscode.window.showErrorMessage("ナレッジを検査するワークスペースを開いてください。");
    return;
  }

  const repositoryPath = vscode.workspace
    .getConfiguration("totonoeKnowledge")
    .get<string>("repositoryPath", "knowledge")
    .trim();
  if (!isValidRepositoryPath(repositoryPath)) {
    void vscode.window.showErrorMessage("repositoryPathにはワークスペース内の相対パスを指定してください。");
    return;
  }

  const files = await vscode.workspace.findFiles(
    new vscode.RelativePattern(root, `${repositoryPath}/**/*.md`),
  );
  const documents: LoadedDocument[] = await Promise.all(files.map(async (uri) => ({
    path: vscode.workspace.asRelativePath(uri),
    content: Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8"),
    uri,
  })));
  const issues = validateKnowledgeDocuments(documents);
  collection.clear();

  for (const document of documents) {
    const lines = document.content.split(/\r?\n/);
    const diagnostics = issues
      .filter((value) => value.path === document.path)
      .map((value) => {
        const line = Math.min(Math.max(value.line, 0), Math.max(lines.length - 1, 0));
        const diagnostic = new vscode.Diagnostic(
          new vscode.Range(line, 0, line, lines[line]?.length ?? 0),
          value.message,
          value.severity === "error" ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning,
        );
        diagnostic.code = value.code;
        diagnostic.source = "Totonoe Knowledge";
        return diagnostic;
      });
    collection.set(document.uri, diagnostics);
  }

  if (!issues.length) {
    void vscode.window.showInformationMessage(`${documents.length}件のナレッジを検査しました。問題はありません。`);
    return;
  }

  const errors = issues.filter((value) => value.severity === "error").length;
  const warnings = issues.length - errors;
  void vscode.window.showWarningMessage(
    `${documents.length}件を検査し、エラー${errors}件・警告${warnings}件を検出しました。`,
  );
  await vscode.commands.executeCommand("workbench.actions.view.problems");
}
