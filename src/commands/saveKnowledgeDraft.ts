import * as vscode from "vscode";
import { persistDraft } from "../knowledge/draftSave";

interface PendingKnowledgeDraft {
  document: vscode.TextDocument;
  target: vscode.Uri;
  relativeTarget: string;
}

const pendingDrafts = new Map<string, PendingKnowledgeDraft>();

function key(uri: vscode.Uri): string {
  return uri.toString(true);
}

export function registerPendingKnowledgeDraft(
  document: vscode.TextDocument,
  target: vscode.Uri,
  relativeTarget: string,
): void {
  pendingDrafts.set(key(document.uri), { document, target, relativeTarget });
}

export function clearPendingKnowledgeDraft(document: vscode.TextDocument): void {
  const savedKey = key(document.uri);
  pendingDrafts.delete(savedKey);
  for (const [draftKey, pending] of pendingDrafts) {
    if (key(pending.target) === savedKey) pendingDrafts.delete(draftKey);
  }
}

function resolvePendingDraft(uri: vscode.Uri): PendingKnowledgeDraft | undefined {
  const registered = pendingDrafts.get(key(uri));
  if (registered) return registered;
  const document = vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString(true) === key(uri));
  if (!document || uri.scheme !== "untitled" || document.languageId !== "markdown") return undefined;
  const target = uri.with({ scheme: "file" });
  return {
    document,
    target,
    relativeTarget: vscode.workspace.asRelativePath(target, false),
  };
}

async function targetExists(target: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(target);
    return true;
  } catch (error) {
    if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") return false;
    throw error;
  }
}

export async function savePendingKnowledgeDraft(uri?: vscode.Uri): Promise<void> {
  const draftUri = uri ?? vscode.window.activeTextEditor?.document.uri;
  const pending = draftUri ? resolvePendingDraft(draftUri) : undefined;
  if (!pending) {
    void vscode.window.showWarningMessage("登録待ちのTotonoe Knowledgeプレビューを開いてください。");
    return;
  }

  const result = await persistDraft({
    targetExists: () => targetExists(pending.target),
    save: async () => await pending.document.save(),
  });
  if (result.status === "conflict") {
    void vscode.window.showErrorMessage(
      `保存先が既に存在するため登録しませんでした: ${pending.relativeTarget}`,
    );
    return;
  }
  if (result.status === "failed") {
    const detail = result.error instanceof Error ? `: ${result.error.message}` : "";
    void vscode.window.showErrorMessage(`ナレッジを保存できませんでした${detail}`);
    return;
  }

  pendingDrafts.delete(key(pending.document.uri));
  await vscode.window.showTextDocument(
    await vscode.workspace.openTextDocument(pending.target),
    { preview: false },
  );
  void vscode.window.showInformationMessage(`ナレッジを登録しました: ${pending.relativeTarget}`);
}
