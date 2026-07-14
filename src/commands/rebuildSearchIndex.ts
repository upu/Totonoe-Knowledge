import * as vscode from "vscode";
import { isValidRepositoryPath } from "../knowledge/repositoryPath";
import {
  knowledgeIndexUri,
  rebuildWorkspaceKnowledgeIndex,
} from "../search/workspaceSearch";

export async function rebuildSearchIndex(): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) {
    void vscode.window.showErrorMessage("検索インデックスを作成するワークスペースを開いてください。");
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

  try {
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Totonoe Knowledgeの検索インデックスを再構築中",
      },
      () => rebuildWorkspaceKnowledgeIndex(root, repositoryPath),
    );
    const count = result.added + result.updated + result.unchanged;
    void vscode.window.showInformationMessage(
      `${count}件から検索インデックスを再構築しました: ${vscode.workspace.asRelativePath(knowledgeIndexUri(root))}`,
    );
  } catch (error) {
    void vscode.window.showErrorMessage(
      `検索インデックスを再構築できませんでした: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
