import * as vscode from "vscode";
import { directoryFor, renderKnowledge, slugify } from "../knowledge/markdown";
import { knowledgeTypes, type KnowledgeDraft, type KnowledgeType } from "../knowledge/types";

type SourceKind = "clipboard" | "selection";

function createId(now: Date): string {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = now.getTime().toString().slice(-6);
  return `K-${date}-${suffix}`;
}

async function getSource(kind: SourceKind): Promise<string | undefined> {
  if (kind === "clipboard") {
    const text = await vscode.env.clipboard.readText();
    if (!text.trim()) {
      void vscode.window.showWarningMessage("クリップボードに登録できるテキストがありません。");
      return undefined;
    }
    return text.trim();
  }

  const editor = vscode.window.activeTextEditor;
  const text = editor?.document.getText(editor.selection).trim();
  if (!text) {
    void vscode.window.showWarningMessage("登録するテキストをエディターで選択してください。");
    return undefined;
  }
  return text;
}

function workspaceRoot(): vscode.Uri | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

export async function registerKnowledge(kind: SourceKind): Promise<void> {
  const root = workspaceRoot();
  if (!root) {
    void vscode.window.showErrorMessage("ナレッジを保存するワークスペースを開いてください。");
    return;
  }

  const source = await getSource(kind);
  if (!source) return;

  const title = await vscode.window.showInputBox({
    title: "ナレッジのタイトル",
    prompt: "後から検索結果を見て内容を判断できるタイトル",
    ignoreFocusOut: true,
  });
  if (!title?.trim()) return;

  const summary = await vscode.window.showInputBox({
    title: "超要約",
    prompt: "このナレッジの結論を1文で記入",
    ignoreFocusOut: true,
  });
  if (summary === undefined) return;

  const selectedType = await vscode.window.showQuickPick([...knowledgeTypes], {
    title: "ナレッジ種別",
    placeHolder: "分類できない場合は investigation",
    ignoreFocusOut: true,
  });
  if (!selectedType) return;
  const type = selectedType as KnowledgeType;

  const keywordInput = await vscode.window.showInputBox({
    title: "検索用キーワード",
    prompt: "カンマ区切り（例: SSH, PTY, stty）",
    ignoreFocusOut: true,
  });
  if (keywordInput === undefined) return;

  const now = new Date();
  const draft: KnowledgeDraft = {
    id: createId(now),
    title: title.trim(),
    summary: summary.trim(),
    type,
    keywords: keywordInput.split(",").map((value) => value.trim()).filter(Boolean),
    source,
    createdAt: now.toISOString(),
  };

  const document = await vscode.workspace.openTextDocument({
    language: "markdown",
    content: renderKnowledge(draft),
  });
  await vscode.window.showTextDocument(document, { preview: false });

  const action = await vscode.window.showInformationMessage(
    "ナレッジ案を確認・編集し、準備ができたら保存してください。",
    "knowledge/へ保存",
  );
  if (action !== "knowledge/へ保存") return;

  const repositoryPath = vscode.workspace
    .getConfiguration("totonoeKnowledge")
    .get<string>("repositoryPath", "knowledge");
  const targetDirectory = vscode.Uri.joinPath(root, repositoryPath, directoryFor(type));
  const target = vscode.Uri.joinPath(targetDirectory, `${draft.id}-${slugify(draft.title)}.md`);

  await vscode.workspace.fs.createDirectory(targetDirectory);
  await vscode.workspace.fs.writeFile(target, Buffer.from(document.getText(), "utf8"));
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(target), { preview: false });
  void vscode.window.showInformationMessage(`ナレッジを保存しました: ${vscode.workspace.asRelativePath(target)}`);
}
