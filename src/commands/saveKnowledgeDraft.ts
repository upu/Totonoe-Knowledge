import * as vscode from "vscode";
import {
  persistApprovedDocumentUpdates,
  persistDraft,
  persistDraftTransaction,
  type DraftDocumentUpdateOperations,
  type DraftSaveResult,
} from "../knowledge/draftSave";
import type { ProposedDocumentUpdate } from "../knowledge/documentUpdate";

interface PendingKnowledgeDraft {
  document: vscode.TextDocument;
  target: vscode.Uri;
  relativeTarget: string;
  repositoryRoot?: vscode.Uri;
  updates: ProposedDocumentUpdate[];
}

const pendingDrafts = new Map<string, PendingKnowledgeDraft>();
const commandSaves = new Set<string>();

function key(uri: vscode.Uri): string {
  return uri.toString(true);
}

export function registerPendingKnowledgeDraft(
  document: vscode.TextDocument,
  target: vscode.Uri,
  relativeTarget: string,
  repositoryRoot?: vscode.Uri,
  updates: readonly ProposedDocumentUpdate[] = [],
): void {
  pendingDrafts.set(key(document.uri), {
    document,
    target,
    relativeTarget,
    repositoryRoot,
    updates: [...updates],
  });
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
    updates: [],
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

function approvedUpdateOperations(
  pending: PendingKnowledgeDraft,
): DraftDocumentUpdateOperations[] {
  if (!pending.repositoryRoot) return [];
  return pending.updates.map((update) => {
    const target = vscode.Uri.joinPath(
      pending.repositoryRoot!,
      ...update.path.split("/"),
    );
    return {
      expectedContent: update.expectedContent,
      proposedContent: update.proposedContent,
      read: async () => Buffer.from(
        await vscode.workspace.fs.readFile(target),
      ).toString("utf8"),
      write: async (content: string) => {
        await vscode.workspace.fs.writeFile(target, Buffer.from(content, "utf8"));
      },
    };
  });
}

async function removeNewTarget(target: vscode.Uri): Promise<void> {
  await vscode.workspace.fs.delete(target);
}

export async function savePendingKnowledgeDraft(uri?: vscode.Uri): Promise<void> {
  const draftUri = uri ?? vscode.window.activeTextEditor?.document.uri;
  const pending = draftUri ? resolvePendingDraft(draftUri) : undefined;
  if (!pending) {
    void vscode.window.showWarningMessage("登録待ちのTotonoe Knowledgeプレビューを開いてください。");
    return;
  }

  const transactionUpdates = approvedUpdateOperations(pending);
  const targetKey = key(pending.target);
  commandSaves.add(targetKey);
  let result: DraftSaveResult;
  try {
    const save = async (): Promise<boolean> => await pending.document.save();
    result = transactionUpdates.length
      ? await persistDraftTransaction({
          targetExists: () => targetExists(pending.target),
          save,
          rollbackNew: () => removeNewTarget(pending.target),
          updates: transactionUpdates,
        })
      : await persistDraft({
          targetExists: () => targetExists(pending.target),
          save,
        });
  } finally {
    commandSaves.delete(targetKey);
  }
  if (result.status === "conflict") {
    void vscode.window.showErrorMessage(
      `保存先または承認済みの既存Markdownが変更されたため登録しませんでした: ${pending.relativeTarget}`,
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

export async function clearPendingKnowledgeDraft(
  document: vscode.TextDocument,
): Promise<void> {
  const savedKey = key(document.uri);
  if (commandSaves.has(savedKey)) return;
  const matching = [...pendingDrafts.entries()]
    .filter(([, pending]) => key(pending.target) === savedKey);
  for (const [draftKey, pending] of matching) {
    const updates = approvedUpdateOperations(pending);
    if (updates.length) {
      const result = await persistApprovedDocumentUpdates({
        rollbackNew: () => removeNewTarget(pending.target),
        updates,
      });
      if (result.status !== "saved") {
        const detail = result.status === "conflict"
          ? "承認後に既存Markdownが変更されました。"
          : result.error instanceof Error
            ? result.error.message
            : "不明なエラー";
        void vscode.window.showErrorMessage(
          `承認済みの変更を反映できなかったため、新規Entryを取り消しました: ${detail}`,
        );
        continue;
      }
      void vscode.window.showInformationMessage(
        `ナレッジと承認済みの関係を登録しました: ${pending.relativeTarget}`,
      );
    }
    pendingDrafts.delete(draftKey);
  }
  pendingDrafts.delete(savedKey);
}
