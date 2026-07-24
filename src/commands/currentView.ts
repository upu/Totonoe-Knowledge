import * as path from "node:path";
import * as vscode from "vscode";
import { buildCurrentViewPrompt } from "../ai/currentViewPrompt";
import { VsCodeCurrentViewGenerator } from "../ai/vsCodeCurrentViewGenerator";
import {
  buildCurrentViewDraft,
  buildCurrentViewSourceUpdates,
  findCurrentViewLinks,
  type CurrentViewIdentity,
  type CurrentViewSource,
} from "../curation/currentView";
import { updateFrontmatterList } from "../curation/relationApproval";
import { createKnowledgeId } from "../knowledge/id";
import { findKnowledgeMarkdownFiles } from "../knowledge/knowledgeFiles";
import { frontmatterList, frontmatterString, parseFrontmatter } from "../knowledge/frontmatter";
import type { ProposedDocumentUpdate } from "../knowledge/documentUpdate";
import {
  persistApprovedDocumentUpdates,
  type DraftDocumentUpdateOperations,
} from "../knowledge/draftSave";
import { prepareKnowledgeTarget } from "../knowledge/repository";
import {
  KnowledgeRepositoryLocator,
  repositoryRelativePath,
} from "../knowledge/repositoryLocation";
import { renderKnowledge } from "../knowledge/markdown";
import {
  describeSecretFindingLocations,
  scanForSecrets,
  summarizeSecretFindings,
} from "../security/secretScanner";
import {
  confirmDocumentUpdates,
  confirmKnowledgeApprovalPlan,
} from "./reviewKnowledgeChanges";
import {
  registerPendingKnowledgeDraft,
  savePendingKnowledgeDraft,
} from "./saveKnowledgeDraft";

const previousModelStorageKey = "totonoeKnowledge.previousLanguageModelId";

interface CurrentViewItem extends vscode.QuickPickItem {
  entry: CurrentViewSource;
}

async function loadEntries(repositoryRoot: vscode.Uri): Promise<CurrentViewSource[]> {
  const files = await findKnowledgeMarkdownFiles(repositoryRoot);
  return (await Promise.all(files.map(async (uri) => {
    const content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
    const parsed = parseFrontmatter(content);
    const id = frontmatterString(parsed, "id")?.trim();
    if (!id) return undefined;
    return {
      id,
      title: frontmatterString(parsed, "title") ?? id,
      summary: frontmatterString(parsed, "summary") ?? "",
      type: frontmatterString(parsed, "type") ?? "unknown",
      keywords: frontmatterList(parsed, "keywords") ?? [],
      path: path.posix.relative(repositoryRoot.path, uri.path),
      updatedAt: frontmatterString(parsed, "updated_at") ?? "",
      content,
    };
  }))).filter((entry): entry is CurrentViewSource => Boolean(entry));
}

function isCurrentView(entry: CurrentViewSource): boolean {
  return (frontmatterList(parseFrontmatter(entry.content), "consolidates")?.length ?? 0) > 0;
}

function item(entry: CurrentViewSource): CurrentViewItem {
  return {
    label: entry.title,
    description: entry.id,
    detail: `${entry.type} · ${entry.path}`,
    entry,
  };
}

async function chooseModel(
  context: vscode.ExtensionContext,
): Promise<vscode.LanguageModelChat | undefined> {
  const models = await vscode.lm.selectChatModels();
  if (!models.length) {
    void vscode.window.showWarningMessage("利用できるAIモデルがないためCurrent Viewを生成できません。");
    return undefined;
  }
  const previous = context.globalState.get<string>(previousModelStorageKey);
  const selected = await vscode.window.showQuickPick(
    [...models]
      .sort((left, right) => Number(right.id === previous) - Number(left.id === previous))
      .map((model) => ({
        label: model.name,
        description: `${model.id === previous ? "前回使用 · " : ""}${model.vendor} · ${model.family}`,
        detail: model.id,
        model,
      })),
    {
      title: "Current View生成に使用するAIモデル",
      ignoreFocusOut: true,
      matchOnDescription: true,
      matchOnDetail: true,
    },
  );
  if (!selected) return undefined;
  await context.globalState.update(previousModelStorageKey, selected.model.id);
  return selected.model;
}

async function confirmModelSend(
  sources: readonly CurrentViewSource[],
  existingTitle?: string,
): Promise<boolean> {
  const enabled = vscode.workspace
    .getConfiguration("totonoeKnowledge")
    .get<boolean>("secretScanning.enabled", true);
  if (!enabled) return true;
  const material = buildCurrentViewPrompt(sources, existingTitle);
  const findings = scanForSecrets(material);
  if (!findings.length) return true;
  const choice = await vscode.window.showWarningMessage(
    `Current Viewの根拠に秘密情報らしい文字列があります（${summarizeSecretFindings(findings)}）。検出箇所: ${describeSecretFindingLocations(material, findings)}。選択したAIモデルへ送信しますか？`,
    { modal: true },
    "キャンセル",
    "理解して送信する",
  );
  return choice === "理解して送信する";
}

function identityFor(entry: CurrentViewSource, now: Date): CurrentViewIdentity {
  const parsed = parseFrontmatter(entry.content);
  return {
    id: entry.id,
    createdAt: frontmatterString(parsed, "created_at") ?? now.toISOString(),
    appliesFrom: frontmatterString(parsed, "applies_from"),
    appliesTo: frontmatterString(parsed, "applies_to"),
    relatedKnowledgeIds: frontmatterList(parsed, "related"),
    supersedesKnowledgeIds: frontmatterList(parsed, "supersedes"),
    conflictKnowledgeIds: frontmatterList(parsed, "conflicts"),
  };
}

async function confirmCurrentViewPreview(markdown: string): Promise<boolean> {
  const enabled = vscode.workspace
    .getConfiguration("totonoeKnowledge")
    .get<boolean>("secretScanning.enabled", true);
  if (!enabled) return true;
  const findings = scanForSecrets(markdown);
  if (!findings.length) return true;
  const choice = await vscode.window.showWarningMessage(
    `Current View案に秘密情報らしい文字列があります（${summarizeSecretFindings(findings)}）。検出箇所: ${describeSecretFindingLocations(markdown, findings)}。この内容を保存先付きプレビューで編集しますか？`,
    { modal: true },
    "確認して編集する",
  );
  return choice === "確認して編集する";
}

function updateOperations(
  repositoryRoot: vscode.Uri,
  updates: readonly ProposedDocumentUpdate[],
): DraftDocumentUpdateOperations[] {
  return updates.map((update) => {
    const target = vscode.Uri.joinPath(repositoryRoot, ...update.path.split("/"));
    return {
      expectedContent: update.expectedContent,
      proposedContent: update.proposedContent,
      read: async () => Buffer.from(await vscode.workspace.fs.readFile(target)).toString("utf8"),
      write: async (content: string) => {
        await vscode.workspace.fs.writeFile(target, Buffer.from(content, "utf8"));
      },
    };
  });
}

async function openPathBoundDraft(
  target: vscode.Uri,
  markdown: string,
): Promise<vscode.TextDocument> {
  const draftUri = target.with({ scheme: "untitled" });
  const document = await vscode.workspace.openTextDocument(draftUri);
  const edit = new vscode.WorkspaceEdit();
  edit.insert(draftUri, new vscode.Position(0, 0), markdown);
  if (!(await vscode.workspace.applyEdit(edit))) {
    throw new Error("Current View案をプレビューへ反映できませんでした。");
  }
  return document;
}

export async function generateCurrentView(
  context: vscode.ExtensionContext,
  repositoryLocator: KnowledgeRepositoryLocator,
): Promise<void> {
  const location = await repositoryLocator.resolveOrNotify();
  if (!location) return;
  const entries = await loadEntries(location.repositoryRoot);
  const currentViews = entries.filter(isCurrentView);
  const mode = await vscode.window.showQuickPick([
    { label: "$(new-file) 新しいCurrent Viewを作る", mode: "new" as const },
    { label: "$(refresh) 既存Current Viewを再生成する", mode: "update" as const },
  ], {
    title: "Current View生成",
    ignoreFocusOut: true,
  });
  if (!mode) return;

  let existing: CurrentViewSource | undefined;
  let sources: CurrentViewSource[];
  const now = new Date();
  if (mode.mode === "update") {
    const selected = await vscode.window.showQuickPick(currentViews.map(item), {
      title: "再生成するCurrent View",
      matchOnDescription: true,
      matchOnDetail: true,
      ignoreFocusOut: true,
    });
    if (!selected) return;
    existing = selected.entry;
    const parsed = parseFrontmatter(existing.content);
    const tracked = frontmatterList(parsed, "consolidates") ?? [];
    const pending = entries
      .filter((entry) =>
        (frontmatterList(parseFrontmatter(entry.content), "affects") ?? [])
          .includes(existing!.id)
      )
      .map((entry) => entry.id);
    const sourceIds = [...new Set([...tracked, ...pending])];
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const missing = sourceIds.filter((id) => !byId.has(id));
    if (missing.length) {
      void vscode.window.showErrorMessage(`根拠Entryが見つかりません: ${missing.join(", ")}`);
      return;
    }
    sources = sourceIds.map((id) => byId.get(id)!);
  } else {
    const selected = await vscode.window.showQuickPick(
      entries.filter((entry) => !isCurrentView(entry)).map(item),
      {
        title: "Current Viewの根拠Entry",
        placeHolder: "1件以上選択",
        canPickMany: true,
        matchOnDescription: true,
        matchOnDetail: true,
        ignoreFocusOut: true,
      },
    );
    if (!selected?.length) return;
    sources = selected.map((value) => value.entry);
  }

  const model = await chooseModel(context);
  if (!model || !(await confirmModelSend(sources, existing?.title))) return;
  const generated = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `${model.name}でCurrent Viewを生成中`,
      cancellable: true,
    },
    async (_progress, token) =>
      new VsCodeCurrentViewGenerator(model, token).generate(sources, existing?.title),
  );
  const identity = existing
    ? identityFor(existing, now)
    : { id: createKnowledgeId(now), createdAt: now.toISOString() };
  const draft = buildCurrentViewDraft(generated, sources, now, identity);
  const sourceUpdates = buildCurrentViewSourceUpdates(sources, draft.id);

  if (existing) {
    const proposed = renderKnowledge(draft);
    const updates: ProposedDocumentUpdate[] = [{
      path: existing.path,
      expectedContent: existing.content,
      proposedContent: proposed,
      reason: "Current View再生成",
    }, ...sourceUpdates];
    const approved = await confirmDocumentUpdates(updates, {
      summary: `Current View 1件と根拠Entry ${sourceUpdates.length}件`,
      approvalLabel: "承認してCurrent Viewを更新",
    });
    if (!approved) return;
    const result = await persistApprovedDocumentUpdates({
      rollbackNew: async () => undefined,
      updates: updateOperations(location.repositoryRoot, approved),
    });
    if (result.status !== "saved") {
      const detail = result.status === "conflict"
        ? "確認後にMarkdownが変更されました。"
        : result.error instanceof Error
          ? result.error.message
          : "不明なエラー";
      void vscode.window.showErrorMessage(`Current Viewを更新できませんでした: ${detail}`);
      return;
    }
    const target = vscode.Uri.joinPath(location.repositoryRoot, ...existing.path.split("/"));
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(target), { preview: false });
    void vscode.window.showInformationMessage(`Current Viewを更新しました: ${existing.path}`);
    return;
  }

  const untrackedDraft = {
    ...draft,
    consolidatedKnowledgeIds: [],
    consolidatedAt: "",
  };
  const approvedSourceUpdates = await confirmKnowledgeApprovalPlan(
    untrackedDraft,
    draft,
    sourceUpdates,
  );
  if (!approvedSourceUpdates) return;
  const markdown = renderKnowledge(draft);
  if (!(await confirmCurrentViewPreview(markdown))) return;
  const target = await prepareKnowledgeTarget(location.repositoryRoot, draft);
  const relativeTarget = repositoryRelativePath(location, target);
  const document = await openPathBoundDraft(target, markdown);
  registerPendingKnowledgeDraft(
    document,
    target,
    relativeTarget,
    location.repositoryRoot,
    approvedSourceUpdates,
  );
  await vscode.window.showTextDocument(document, { preview: false });
  const action = await vscode.window.showInformationMessage(
    `Current View案を確認・編集して登録してください。保存先: ${relativeTarget}`,
    "この内容を登録",
  );
  if (action === "この内容を登録") await savePendingKnowledgeDraft(document.uri);
}

async function activeEntry(
  entries: readonly CurrentViewSource[],
): Promise<CurrentViewSource | undefined> {
  const active = vscode.window.activeTextEditor?.document;
  if (active) {
    const id = frontmatterString(parseFrontmatter(active.getText()), "id");
    const found = entries.find((entry) => entry.id === id);
    if (found) return found;
  }
  const selected = await vscode.window.showQuickPick(entries.map(item), {
    title: "Knowledge Entryを選択",
    matchOnDescription: true,
    matchOnDetail: true,
  });
  return selected?.entry;
}

export async function showCurrentViewLinks(
  repositoryLocator: KnowledgeRepositoryLocator,
): Promise<void> {
  const location = await repositoryLocator.resolveOrNotify();
  if (!location) return;
  const entries = await loadEntries(location.repositoryRoot);
  const active = await activeEntry(entries);
  if (!active) return;
  const links = findCurrentViewLinks(entries, active.id);
  const items = [
    ...links.sources.map((entry) => ({
      ...item(entry),
      detail: `根拠Entry · ${entry.path}`,
    })),
    ...links.currentViews.map((entry) => ({
      ...item(entry),
      detail: `取り込み先Current View · ${entry.path}`,
    })),
  ];
  const selected = await vscode.window.showQuickPick(items, {
    title: `${active.title} のCurrent View追跡`,
    placeHolder: items.length ? `${items.length}件` : "追跡リンクはありません",
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!selected) return;
  const target = vscode.Uri.joinPath(location.repositoryRoot, ...selected.entry.path.split("/"));
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(target), { preview: false });
}

export async function markCurrentViewAffected(
  repositoryLocator: KnowledgeRepositoryLocator,
): Promise<void> {
  const location = await repositoryLocator.resolveOrNotify();
  if (!location) return;
  const entries = await loadEntries(location.repositoryRoot);
  const active = await activeEntry(entries);
  if (!active || isCurrentView(active)) {
    void vscode.window.showWarningMessage("粒ナレッジのEntryを選択してください。");
    return;
  }
  const selected = await vscode.window.showQuickPick(
    entries.filter(isCurrentView).map(item),
    {
      title: "反映待ちにするCurrent View",
      matchOnDescription: true,
      matchOnDetail: true,
    },
  );
  if (!selected) return;
  const proposed = updateFrontmatterList(active.content, "affects", [selected.entry.id]);
  const approved = await confirmDocumentUpdates([{
    path: active.path,
    expectedContent: active.content,
    proposedContent: proposed,
    reason: `Current View ${selected.entry.id}への反映待ち`,
  }], {
    summary: `${active.id}のaffectsへ${selected.entry.id}を追加`,
    approvalLabel: "承認して反映待ちにする",
  });
  if (!approved) return;
  const result = await persistApprovedDocumentUpdates({
    rollbackNew: async () => undefined,
    updates: updateOperations(location.repositoryRoot, approved),
  });
  if (result.status !== "saved") {
    void vscode.window.showErrorMessage("affectsを更新できませんでした。再度確認してください。");
    return;
  }
  void vscode.window.showInformationMessage(
    `${active.id}を${selected.entry.id}への反映待ちにしました。`,
  );
}
