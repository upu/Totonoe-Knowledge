import * as vscode from "vscode";
import { KnowledgeRepositoryLocator } from "../knowledge/repositoryLocation";
import { describeVersionRange, parseComparableVersion } from "../knowledge/versioning";
import { searchWorkspaceKnowledge } from "../search/workspaceSearch";

interface SearchItem extends vscode.QuickPickItem {
  uri: vscode.Uri;
  score: number;
}

export async function searchKnowledge(
  repositoryLocator: KnowledgeRepositoryLocator,
  promptForVersion = false,
): Promise<void> {
  const location = await repositoryLocator.resolveOrNotify();
  if (!location) return;

  const version = promptForVersion
    ? await vscode.window.showInputBox({
        title: "対象バージョン",
        prompt: "このバージョンで有効なナレッジだけを検索（例: 17.1、RHEL9.2）",
        ignoreFocusOut: true,
        validateInput: (value) => value.trim() && !parseComparableVersion(value)
          ? "比較可能なバージョンを入力してください（例: 17.1、RHEL9.2）"
          : undefined,
      })
    : undefined;
  if (promptForVersion && !version?.trim()) return;

  const query = await vscode.window.showInputBox({
    title: "Totonoe Knowledge Search",
    prompt: "タイトル、要約、キーワード、本文を検索",
    ignoreFocusOut: true,
  });
  if (!query?.trim()) return;

  const search = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: "Totonoe Knowledgeを検索中" },
    () => searchWorkspaceKnowledge(
      location.repositoryRoot,
      location.indexRoot,
      query.trim(),
      version?.trim(),
    ),
  );
  if (search.indexError) {
    void vscode.window.showWarningMessage(
      `SQLite検索インデックスを利用できないため直接検索しました: ${search.indexError?.message ?? "不明なエラー"}`,
    );
  }
  if (search.embeddingError) {
    void vscode.window.showWarningMessage(
      `意味検索を利用できなかったため、全文検索へ切り替えました: ${search.embeddingError.message}`,
    );
  }

  const items: SearchItem[] = search.results.map((result) => ({
    label: result.title,
    description: result.summary,
    detail: `${result.type} · ${result.status} · ${describeVersionRange(result.appliesFrom, result.appliesTo)} · ${search.backend} score ${result.score.toFixed(2)} · ${result.scoreBreakdown.reasons.join(" / ")} · ${result.path}`,
    uri: vscode.Uri.joinPath(location.repositoryRoot, ...result.path.split("/")),
    score: result.score,
  }));
  const selected = await vscode.window.showQuickPick(items, {
    title: version ? `検索結果: ${query}（${version.trim()}）` : `検索結果: ${query}`,
    placeHolder: items.length ? `${items.length}件見つかりました` : "一致するナレッジはありません",
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (selected) {
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(selected.uri), { preview: false });
  }
}
