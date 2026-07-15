import * as vscode from "vscode";
import { KnowledgeRepositoryLocator } from "../knowledge/repositoryLocation";
import { searchWorkspaceKnowledge } from "../search/workspaceSearch";

interface SearchItem extends vscode.QuickPickItem {
  uri: vscode.Uri;
  score: number;
}

export async function searchKnowledge(repositoryLocator: KnowledgeRepositoryLocator): Promise<void> {
  const location = await repositoryLocator.resolveOrNotify();
  if (!location) return;

  const query = await vscode.window.showInputBox({
    title: "Totonoe Knowledge Search",
    prompt: "タイトル、要約、キーワード、本文を検索",
    ignoreFocusOut: true,
  });
  if (!query?.trim()) return;

  const search = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: "Totonoe Knowledgeを検索中" },
    () => searchWorkspaceKnowledge(location.repositoryRoot, location.indexRoot, query.trim()),
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
    uri: vscode.Uri.joinPath(location.repositoryRoot, ...result.path.split("/")),
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
