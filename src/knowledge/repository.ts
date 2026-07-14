import * as vscode from "vscode";
import { directoryFor, renderKnowledge, slugify } from "./markdown";
import type { KnowledgeDraft } from "./types";

export function knowledgeTarget(
  root: vscode.Uri,
  repositoryPath: string,
  draft: KnowledgeDraft,
): vscode.Uri {
  return vscode.Uri.joinPath(
    root,
    repositoryPath,
    directoryFor(draft.type),
    `${draft.id}-${slugify(draft.title)}.md`,
  );
}

export async function prepareKnowledgeTarget(
  root: vscode.Uri,
  repositoryPath: string,
  draft: KnowledgeDraft,
): Promise<vscode.Uri> {
  const target = knowledgeTarget(root, repositoryPath, draft);
  await vscode.workspace.fs.createDirectory(
    vscode.Uri.joinPath(root, repositoryPath, directoryFor(draft.type)),
  );
  try {
    await vscode.workspace.fs.stat(target);
    throw new Error(`同じIDのナレッジファイルがすでに存在します: ${draft.id}`);
  } catch (error) {
    if (!(error instanceof vscode.FileSystemError) || error.code !== "FileNotFound") throw error;
  }
  return target;
}

export async function saveKnowledgeDraft(
  root: vscode.Uri,
  repositoryPath: string,
  draft: KnowledgeDraft,
  markdown = renderKnowledge(draft),
): Promise<vscode.Uri> {
  const target = await prepareKnowledgeTarget(root, repositoryPath, draft);
  await vscode.workspace.fs.writeFile(target, Buffer.from(markdown, "utf8"));
  return target;
}
