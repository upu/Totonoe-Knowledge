import * as vscode from "vscode";
import { findKnowledgeMarkdownFiles } from "../knowledge/knowledgeFiles";
import {
  KnowledgeRepositoryLocator,
  repositoryRelativePath,
} from "../knowledge/repositoryLocation";
import { validateKnowledgeDocuments } from "../validation/knowledgeValidator";

interface LoadedDocument {
  path: string;
  content: string;
  uri: vscode.Uri;
}

export async function validateKnowledgeRepository(
  collection: vscode.DiagnosticCollection,
  repositoryLocator: KnowledgeRepositoryLocator,
): Promise<void> {
  const location = await repositoryLocator.resolveOrNotify();
  if (!location) return;
  const files = await findKnowledgeMarkdownFiles(location.repositoryRoot);
  const documents: LoadedDocument[] = await Promise.all(files.map(async (uri) => ({
    path: repositoryRelativePath(location, uri),
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
