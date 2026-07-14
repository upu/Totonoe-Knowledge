import * as vscode from "vscode";
import { directoryFor, renderKnowledge, slugify } from "./markdown";
import type { KnowledgeDraft } from "./types";

export async function saveKnowledgeDraft(
  root: vscode.Uri,
  repositoryPath: string,
  draft: KnowledgeDraft,
  markdown = renderKnowledge(draft),
): Promise<vscode.Uri> {
  const targetDirectory = vscode.Uri.joinPath(root, repositoryPath, directoryFor(draft.type));
  const target = vscode.Uri.joinPath(targetDirectory, `${draft.id}-${slugify(draft.title)}.md`);
  await vscode.workspace.fs.createDirectory(targetDirectory);
  await vscode.workspace.fs.writeFile(target, Buffer.from(markdown, "utf8"));
  return target;
}
