import * as vscode from "vscode";
import { persistDraft, persistDraftTransaction } from "./draftSave";
import type { ProposedDocumentUpdate } from "./documentUpdate";
import { directoryFor, knowledgeTargetReference, renderKnowledge } from "./markdown";
import type { KnowledgeDraft } from "./types";
import { validateKnowledgeDocuments } from "../validation/knowledgeValidator";

export function knowledgeTarget(
  repositoryRoot: vscode.Uri,
  draft: KnowledgeDraft,
): vscode.Uri {
  return vscode.Uri.joinPath(repositoryRoot, ...knowledgeTargetReference(draft).split("/"));
}

export async function prepareKnowledgeTarget(
  repositoryRoot: vscode.Uri,
  draft: KnowledgeDraft,
): Promise<vscode.Uri> {
  const target = knowledgeTarget(repositoryRoot, draft);
  await vscode.workspace.fs.createDirectory(
    vscode.Uri.joinPath(repositoryRoot, directoryFor(draft.type)),
  );
  try {
    await vscode.workspace.fs.stat(target);
    throw new Error(`同じIDのナレッジファイルがすでに存在します: ${draft.id}`);
  } catch (error) {
    if (!(error instanceof vscode.FileSystemError) || error.code !== "FileNotFound") throw error;
  }
  return target;
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

export async function saveKnowledgeDraft(
  repositoryRoot: vscode.Uri,
  draft: KnowledgeDraft,
  markdown = renderKnowledge(draft),
  updates: readonly ProposedDocumentUpdate[] = [],
): Promise<vscode.Uri> {
  const reference = knowledgeTargetReference(draft);
  const validationErrors = validateKnowledgeDocuments([{ path: reference, content: markdown }])
    .filter((issue) => issue.severity === "error");
  if (validationErrors.length) {
    throw new Error(
      `Knowledge validationに失敗しました: ${validationErrors.map((issue) => issue.code).join(", ")}`,
    );
  }

  const target = knowledgeTarget(repositoryRoot, draft);
  await vscode.workspace.fs.createDirectory(
    vscode.Uri.joinPath(repositoryRoot, directoryFor(draft.type)),
  );
  const save = async (): Promise<true> => {
    await vscode.workspace.fs.writeFile(target, Buffer.from(markdown, "utf8"));
    return true;
  };
  const transactionUpdates = updates.map((update) => {
    const updateTarget = vscode.Uri.joinPath(repositoryRoot, ...update.path.split("/"));
    return {
      expectedContent: update.expectedContent,
      proposedContent: update.proposedContent,
      read: async () => Buffer.from(
        await vscode.workspace.fs.readFile(updateTarget),
      ).toString("utf8"),
      write: async (content: string) => {
        await vscode.workspace.fs.writeFile(updateTarget, Buffer.from(content, "utf8"));
      },
    };
  });
  const result = transactionUpdates.length
    ? await persistDraftTransaction({
        targetExists: () => targetExists(target),
        save,
        rollbackNew: async () => {
          await vscode.workspace.fs.delete(target);
        },
        updates: transactionUpdates,
      })
    : await persistDraft({
        targetExists: () => targetExists(target),
        save,
      });
  if (result.status === "conflict") {
    throw new Error(`同じIDのナレッジファイルがすでに存在します: ${draft.id}`);
  }
  if (result.status === "failed") {
    if (result.error instanceof Error) throw result.error;
    throw new Error("ナレッジを保存できませんでした。");
  }
  return target;
}
