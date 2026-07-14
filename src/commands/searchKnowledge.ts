import * as vscode from "vscode";
import { searchKnowledgeDocuments } from "../search/searchEngine";

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
    .get<string>("repositoryPath", "knowledge");
  const files = await vscode.workspace.findFiles(
    new vscode.RelativePattern(root, `${repositoryPath}/**/*.md`),
  );

  const documents: Array<{ path: string; content: string; uri: vscode.Uri }> = [];
  for (const uri of files) {
    const content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
    documents.push({ path: vscode.workspace.asRelativePath(uri), content, uri });
  }

  const items: SearchItem[] = searchKnowledgeDocuments(documents, query.trim()).map((result) => ({
    label: result.title,
    description: result.summary,
    detail: `${result.type} · ${result.status} · score ${result.score} · ${result.path}`,
    uri: documents.find((document) => document.path === result.path)!.uri,
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
