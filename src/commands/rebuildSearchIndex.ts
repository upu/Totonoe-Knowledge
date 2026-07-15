import * as vscode from "vscode";
import {
  KnowledgeRepositoryLocator,
  describeRepositoryLocation,
} from "../knowledge/repositoryLocation";
import {
  knowledgeIndexUri,
  rebuildWorkspaceKnowledgeIndex,
} from "../search/workspaceSearch";

export async function rebuildSearchIndex(repositoryLocator: KnowledgeRepositoryLocator): Promise<void> {
  const location = await repositoryLocator.resolveOrNotify();
  if (!location) return;

  try {
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Totonoe Knowledgeの検索インデックスを再構築中",
      },
      () => rebuildWorkspaceKnowledgeIndex(location.repositoryRoot, location.indexRoot),
    );
    const count = result.added + result.updated + result.unchanged;
    void vscode.window.showInformationMessage(
      `${count}件から検索インデックスを再構築しました: ${knowledgeIndexUri(location.indexRoot).toString(true)}（${describeRepositoryLocation(location)}）`,
    );
  } catch (error) {
    void vscode.window.showErrorMessage(
      `検索インデックスを再構築できませんでした: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
