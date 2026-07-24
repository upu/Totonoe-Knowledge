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
  return await confirmDocumentUpdates(updates, {
    newEntryDocuments,
    summary: `新規Entryの関係${before === after ? "なし" : "あり"}、既存Markdown ${updates.length}件`,
    approvalLabel: "承認してプレビューへ",
  });
}

interface ConfirmDocumentUpdatesOptions {
  newEntryDocuments?: {
    before: vscode.TextDocument;
    after: vscode.TextDocument;
  };
  summary?: string;
  approvalLabel?: string;
}

export async function confirmDocumentUpdates(
  updates: readonly ProposedDocumentUpdate[],
  options: ConfirmDocumentUpdatesOptions = {},
): Promise<ProposedDocumentUpdate[] | undefined> {
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
      `承認する変更案: ${options.summary ?? `既存Markdown ${updates.length}件`}。承認前は正本へ書き込みません。`,
      { modal: true },
      "差分を確認",
      options.approvalLabel ?? "承認して反映",
      "キャンセル",
    );
    if (action === (options.approvalLabel ?? "承認して反映")) {
      return editableUpdates.map(({ update, after: edited }) => ({
        ...update,
        proposedContent: edited.getText(),
      }));
    }
    if (action !== "差分を確認") return undefined;
    if (options.newEntryDocuments) {
      await showMarkdownDiff(
        options.newEntryDocuments.before,
        options.newEntryDocuments.after,
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
