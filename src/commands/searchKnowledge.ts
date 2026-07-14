import * as vscode from "vscode";

interface SearchItem extends vscode.QuickPickItem {
  uri: vscode.Uri;
  score: number;
}

function frontmatterValue(content: string, key: string): string | undefined {
  const match = content.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  return match?.[1]?.replace(/^"|"$/g, "");
}

function score(content: string, query: string): number {
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const title = frontmatterValue(content, "title")?.toLocaleLowerCase() ?? "";
  const summary = frontmatterValue(content, "summary")?.toLocaleLowerCase() ?? "";
  const all = content.toLocaleLowerCase();
  return terms.reduce((total, term) => {
    if (title.includes(term)) total += 8;
    if (summary.includes(term)) total += 5;
    if (all.includes(term)) total += 1;
    return total;
  }, 0);
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

  const items: SearchItem[] = [];
  for (const uri of files) {
    const content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
    const itemScore = score(content, query.trim());
    if (itemScore === 0) continue;
    items.push({
      label: frontmatterValue(content, "title") ?? vscode.workspace.asRelativePath(uri),
      description: frontmatterValue(content, "summary"),
      detail: vscode.workspace.asRelativePath(uri),
      uri,
      score: itemScore,
    });
  }

  items.sort((a, b) => b.score - a.score);
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

