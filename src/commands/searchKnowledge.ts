import * as vscode from "vscode";
import { isValidRepositoryPath } from "../knowledge/repositoryPath";
import { searchWorkspaceKnowledge } from "../search/workspaceSearch";

interface SearchItem extends vscode.QuickPickItem {
  uri: vscode.Uri;
  score: number;
}

export async function searchKnowledge(): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) {
    void vscode.window.showErrorMessage("検索するワークスペースを開いてください。");
    return;
  }

  const query = await vscode.window.showInputBox({
    title: "Totonoe Knowledge Search",
    prompt: "タイトル、要約、キーワード、本文を検索",
    ignoreFocusOut: true,
  });
  if (!query?.trim()) return;

  const repositoryPath = vscode.workspace
    .getConfiguration("totonoeKnowledge")
    .get<string>("repositoryPath", "knowledge")
    .trim();
  if (!isValidRepositoryPath(repositoryPath)) {
    void vscode.window.showErrorMessage("repositoryPathにはワークスペース内の相対パスを指定してください。");
    return;
  }

  const search = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: "Totonoe Knowledgeを検索中" },
    () => searchWorkspaceKnowledge(root, repositoryPath, query.trim()),
  );
  if (search.indexError) {
    void vscode.window.showWarningMessage(
      `SQLite検索インデックスを利用できないため直接検索しました: ${search.indexError?.message ?? "不明なエラー"}`,
    );
  }

  const items: SearchItem[] = search.results.map((result) => ({
    label: result.title,
    description: result.summary,
    detail: `${result.type} · ${result.status} · score ${result.score} · ${result.path}`,
    uri: vscode.Uri.joinPath(root, ...result.path.split("/")),
    score: result.score,
  }));
  const selected = await vscode.window.showQuickPick(items, {
    title: `検索結果: ${query}`,
    placeHolder: items.length ? `${items.length}件見つかりました` : "一致するナレッジはありません",
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (selected) {
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(selected.uri), { preview: false });
  }
}
