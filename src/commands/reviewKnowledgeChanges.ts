import * as vscode from "vscode";
import type { ProposedDocumentUpdate } from "../knowledge/documentUpdate";
import { renderKnowledge } from "../knowledge/markdown";
import type { KnowledgeDraft } from "../knowledge/types";

async function showMarkdownDiff(
  before: vscode.TextDocument,
  after: vscode.TextDocument,
  title: string,
): Promise<void> {
  await vscode.commands.executeCommand(
    "vscode.diff",
    before.uri,
    after.uri,
    title,
  );
}

export async function confirmKnowledgeApprovalPlan(
  originalDraft: KnowledgeDraft,
  approvedDraft: KnowledgeDraft,
  updates: readonly ProposedDocumentUpdate[],
): Promise<ProposedDocumentUpdate[] | undefined> {
  const before = renderKnowledge(originalDraft);
  const after = renderKnowledge(approvedDraft);
  const newEntryDocuments = before === after
    ? undefined
    : {
        before: await vscode.workspace.openTextDocument({
          language: "markdown",
          content: before,
        }),
        after: await vscode.workspace.openTextDocument({
          language: "markdown",
          content: after,
        }),
      };
  const editableUpdates = await Promise.all(updates.map(async (update) => ({
    update,
    before: await vscode.workspace.openTextDocument({
      language: "markdown",
      content: update.expectedContent,
    }),
    after: await vscode.workspace.openTextDocument({
      language: "markdown",
      content: update.proposedContent,
    }),
  })));
  while (true) {
    const action = await vscode.window.showInformationMessage(
      `承認する変更案: 新規Entryの関係${before === after ? "なし" : "あり"}、既存Markdown ${updates.length}件。正本への書き込みは登録操作まで行いません。`,
      { modal: true },
      "差分を確認",
      "承認してプレビューへ",
      "キャンセル",
    );
    if (action === "承認してプレビューへ") {
      return editableUpdates.map(({ update, after: edited }) => ({
        ...update,
        proposedContent: edited.getText(),
      }));
    }
    if (action !== "差分を確認") return undefined;
    if (newEntryDocuments) {
      await showMarkdownDiff(
        newEntryDocuments.before,
        newEntryDocuments.after,
        "新規Entryのfront matter変更案",
      );
    }
    for (const { update, before: original, after: proposed } of editableUpdates) {
      await showMarkdownDiff(
        original,
        proposed,
        `${update.path}: ${update.reason}`,
      );
    }
  }
}
