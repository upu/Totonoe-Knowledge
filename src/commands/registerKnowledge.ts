import * as vscode from "vscode";
import { requiresMetadataInput, type GenerationOrigin } from "../ai/generationOrigin";
import { orderModelsByPreviousSelection } from "../ai/modelSelection";
import { VsCodeRelationCandidateClassifier } from "../ai/relationCandidateClassifier";
import { buildRelationCandidatePrompt } from "../ai/relationCandidatePrompt";
import { TemplateOnlyGenerator } from "../ai/templateOnlyGenerator";
import { VsCodeLanguageModelGenerator } from "../ai/vsCodeLanguageModelGenerator";
import {
  classifyRelationCandidates,
  relationCandidateQuery,
  relationKinds,
  selectRelationCandidates,
  type RelationSuggestion,
} from "../curation/relationCandidates";
import {
  buildRelationApprovalPlan,
  type RelationDecision,
} from "../curation/relationApproval";
import type { ProposedDocumentUpdate } from "../knowledge/documentUpdate";
import { renderKnowledge } from "../knowledge/markdown";
import { createKnowledgeId } from "../knowledge/id";
import { prepareKnowledgeTarget, saveKnowledgeDraft } from "../knowledge/repository";
import {
  KnowledgeRepositoryLocator,
  repositoryRelativePath,
} from "../knowledge/repositoryLocation";
import {
  knowledgeTypes,
  type GeneratedKnowledge,
  type KnowledgeDraft,
  type KnowledgeSource,
  type KnowledgeType,
} from "../knowledge/types";
import {
  describeSecretFindingLocations,
  scanForSecrets,
  summarizeSecretFindings,
} from "../security/secretScanner";
import { searchWorkspaceKnowledge } from "../search/workspaceSearch";
import {
  registerPendingKnowledgeDraft,
  savePendingKnowledgeDraft,
} from "./saveKnowledgeDraft";
import { confirmKnowledgeApprovalPlan } from "./reviewKnowledgeChanges";

type SourceKind = KnowledgeSource["kind"];
type GeneratorMode = "ask" | "template" | "languageModel";
type SelectedGeneratorMode = Exclude<GeneratorMode, "ask">;

interface GenerationResult {
  generated: GeneratedKnowledge;
  origin: GenerationOrigin;
}

const previousModelStorageKey = "totonoeKnowledge.previousLanguageModelId";

async function getSource(kind: SourceKind): Promise<KnowledgeSource | undefined> {
  if (kind === "clipboard") {
    const text = await vscode.env.clipboard.readText();
    if (!text.trim()) {
      void vscode.window.showWarningMessage("クリップボードに登録できるテキストがありません。");
      return undefined;
    }
    return { kind, text: text.trim() };
  }

  const editor = vscode.window.activeTextEditor;
  const text = editor?.document.getText(editor.selection).trim();
  if (!text) {
    void vscode.window.showWarningMessage("登録するテキストをエディターで選択してください。");
    return undefined;
  }
  return { kind, text };
}

async function chooseGeneratorMode(configured: GeneratorMode): Promise<SelectedGeneratorMode | undefined> {
  if (configured !== "ask") return configured;
  const selected = await vscode.window.showQuickPick([
    {
      label: "$(sparkle) AIでナレッジ案を作る",
      description: "コピー内容を次の画面で選ぶAIモデルへ送り、要約・分類・本文を生成",
      mode: "languageModel" as const,
    },
    {
      label: "$(file-text) AIを使わずナレッジ案を作る",
      description: "構造化済みMarkdownを読み込むか、通常テキスト用の入力ひな形を作成",
      mode: "template" as const,
    },
  ], {
    title: "ナレッジ案の生成方法",
    ignoreFocusOut: true,
  });
  return selected?.mode;
}

async function confirmExternalSend(source: KnowledgeSource): Promise<"send" | "template" | undefined> {
  const enabled = vscode.workspace
    .getConfiguration("totonoeKnowledge")
    .get<boolean>("secretScanning.enabled", true);
  if (!enabled) return "send";

  const findings = scanForSecrets(source.text);
  if (!findings.length) return "send";
  const choice = await vscode.window.showWarningMessage(
    `入力に秘密情報らしい文字列があります（${summarizeSecretFindings(findings)}）。検出箇所: ${describeSecretFindingLocations(source.text, findings)}。選択したAIモデルへ送信しますか？検出には誤りや見逃しがあります。`,
    { modal: true },
    "テンプレートで続ける",
    "理解して送信する",
  );
  if (choice === "理解して送信する") return "send";
  if (choice === "テンプレートで続ける") return "template";
  return undefined;
}

async function chooseLanguageModel(
  context: vscode.ExtensionContext,
  unavailableMessage = "利用できるAIモデルがありません。入力用テンプレートへ切り替えます。",
): Promise<vscode.LanguageModelChat | null | undefined> {
  const models = await vscode.lm.selectChatModels();
  if (!models.length) {
    void vscode.window.showWarningMessage(unavailableMessage);
    return null;
  }
  const previousModelId = context.globalState.get<string>(previousModelStorageKey);
  const selected = await vscode.window.showQuickPick(
    orderModelsByPreviousSelection(models, previousModelId).map((model) => ({
      label: model.name,
      description: `${model.id === previousModelId ? "前回使用 · " : ""}${model.vendor} · ${model.family}`,
      detail: model.id,
      model,
    })),
    {
      title: "ナレッジ生成に使用するAIモデル",
      placeHolder: "前回使用したモデルを先頭に表示します",
      ignoreFocusOut: true,
      matchOnDescription: true,
      matchOnDetail: true,
    },
  );
  if (selected) await context.globalState.update(previousModelStorageKey, selected.model.id);
  return selected?.model;
}

async function generateKnowledge(
  source: KnowledgeSource,
  mode: SelectedGeneratorMode,
  context: vscode.ExtensionContext,
): Promise<GenerationResult | undefined> {
  const generator = new TemplateOnlyGenerator();

  if (mode === "languageModel") {
    const sendChoice = await confirmExternalSend(source);
    if (!sendChoice) return undefined;
    if (sendChoice === "send") {
      const model = await chooseLanguageModel(context);
      if (model === undefined) return undefined;
      if (model) {
        try {
          const generated = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `${model.name}でナレッジ案を生成中`, cancellable: true },
            async (_progress, token) => new VsCodeLanguageModelGenerator(model, token).generate(source),
          );
          return { generated, origin: "languageModel" };
        } catch (error) {
          const message = error instanceof vscode.LanguageModelError
            ? `AIモデルを利用できませんでした（${error.code}）。`
            : `ナレッジ案を生成できませんでした: ${error instanceof Error ? error.message : String(error)}`;
          const fallback = await vscode.window.showWarningMessage(message, "テンプレートで続ける");
          if (fallback !== "テンプレートで続ける") return undefined;
        }
      }
    }
  }

  try {
    const generated = await generator.generateWithOrigin(source);
    return generated;
  } catch (error) {
    void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

async function editMetadata(generated: GeneratedKnowledge): Promise<GeneratedKnowledge | undefined> {
  const title = await vscode.window.showInputBox({
    title: "ナレッジのタイトル",
    prompt: "後から検索結果を見て内容を判断できるタイトル",
    value: generated.title,
    ignoreFocusOut: true,
  });
  if (!title?.trim()) return undefined;

  const summary = await vscode.window.showInputBox({
    title: "超要約",
    prompt: "このナレッジの結論を1文で記入",
    value: generated.summary,
    ignoreFocusOut: true,
  });
  if (summary === undefined) return undefined;

  const selectedType = await vscode.window.showQuickPick(
    knowledgeTypes.map((type) => ({ label: type, picked: type === generated.type })),
    {
      title: "ナレッジ種別",
      placeHolder: "分類できない場合は investigation",
      ignoreFocusOut: true,
    },
  );
  if (!selectedType) return undefined;

  const keywordInput = await vscode.window.showInputBox({
    title: "検索用キーワード",
    prompt: "カンマ区切り（例: SSH, PTY, stty）",
    value: generated.keywords.join(", "),
    ignoreFocusOut: true,
  });
  if (keywordInput === undefined) return undefined;

  return {
    ...generated,
    title: title.trim(),
    summary: summary.trim(),
    type: selectedType.label as KnowledgeType,
    keywords: keywordInput.split(",").map((value) => value.trim()).filter(Boolean),
  };
}

async function confirmRelationCandidateSend(
  draft: KnowledgeDraft,
  candidates: Parameters<typeof buildRelationCandidatePrompt>[1],
): Promise<boolean> {
  const enabled = vscode.workspace
    .getConfiguration("totonoeKnowledge")
    .get<boolean>("secretScanning.enabled", true);
  if (!enabled) return true;
  const material = buildRelationCandidatePrompt(draft, candidates);
  const findings = scanForSecrets(material);
  if (!findings.length) return true;

  const choice = await vscode.window.showWarningMessage(
    `関係候補の比較内容に秘密情報らしい文字列があります（${summarizeSecretFindings(findings)}）。検出箇所: ${describeSecretFindingLocations(material, findings)}。選択したAIモデルへ送信しますか？`,
    { modal: true },
    "候補確認を省略",
    "理解して送信する",
  );
  return choice === "理解して送信する";
}

interface RelationSuggestionItem extends vscode.QuickPickItem {
  action: "accept" | "edit" | "reject" | "evidence";
}

async function openRelationEvidence(
  repositoryRoot: vscode.Uri,
  suggestion: RelationSuggestion,
): Promise<void> {
  const evidence = vscode.Uri.joinPath(
    repositoryRoot,
    ...suggestion.evidence.path.split("/"),
  );
  try {
    await vscode.window.showTextDocument(
      await vscode.workspace.openTextDocument(evidence),
      { preview: true },
    );
  } catch (error) {
    void vscode.window.showWarningMessage(
      `根拠Entryを開けませんでした: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function decideRelationSuggestion(
  repositoryRoot: vscode.Uri,
  suggestion: RelationSuggestion,
): Promise<RelationDecision | undefined> {
  while (true) {
    const items: RelationSuggestionItem[] = [
      {
        label: `$(check) ${suggestion.relation}として採用`,
        detail: suggestion.reason,
        action: "accept",
      },
      {
        label: "$(edit) 関係種別を編集して採用",
        detail: `推定: ${suggestion.relation}`,
        action: "edit",
      },
      {
        label: "$(close) この候補を却下",
        action: "reject",
      },
      {
        label: "$(go-to-file) 根拠Entryを開く",
        detail: `${suggestion.evidence.id} · ${suggestion.evidence.path}`,
        action: "evidence",
      },
    ];
    const selected = await vscode.window.showQuickPick(items, {
      title: `${suggestion.evidence.title}（${suggestion.evidence.id}）`,
      placeHolder: `${suggestion.isCurrentView ? "Current View · " : ""}${suggestion.reason}`,
      matchOnDescription: true,
      matchOnDetail: true,
      ignoreFocusOut: true,
    });
    if (!selected) return undefined;
    if (selected.action === "evidence") {
      await openRelationEvidence(repositoryRoot, suggestion);
      continue;
    }
    if (selected.action === "reject") {
      return { id: suggestion.id, action: "reject" };
    }
    if (selected.action === "accept") {
      return {
        id: suggestion.id,
        action: "accept",
        relation: suggestion.relation,
      };
    }
    const relation = await vscode.window.showQuickPick(
      relationKinds.map((value) => ({
        label: value,
        picked: value === suggestion.relation,
      })),
      {
        title: `${suggestion.evidence.title}との関係種別`,
        placeHolder: "推定を編集して採用",
        ignoreFocusOut: true,
      },
    );
    if (!relation) return undefined;
    return { id: suggestion.id, action: "accept", relation: relation.label };
  }
}

type RelationReviewOutcome =
  | {
      status: "continue";
      draft: KnowledgeDraft;
      updates: ProposedDocumentUpdate[];
    }
  | { status: "cancelled" };

async function reviewRelationCandidates(
  draft: KnowledgeDraft,
  repositoryRoot: vscode.Uri,
  indexRoot: vscode.Uri,
  context: vscode.ExtensionContext,
): Promise<RelationReviewOutcome> {
  const action = await vscode.window.showInformationMessage(
    "保存前に、既存Knowledge Entryとの関係候補を理由・根拠付きで確認しますか？",
    "候補を確認",
    "省略して続ける",
  );
  if (action !== "候補を確認") {
    return { status: "continue", draft, updates: [] };
  }

  const search = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: "関係候補を検索中" },
    () => searchWorkspaceKnowledge(
      repositoryRoot,
      indexRoot,
      relationCandidateQuery(draft),
      undefined,
      { readOnly: true },
    ),
  );
  const candidates = selectRelationCandidates(draft, search.results);
  if (!candidates.length) {
    void vscode.window.showInformationMessage(
      "比較する既存Entryが見つからなかったため、関係を設定せず登録を続けます。",
    );
    return { status: "continue", draft, updates: [] };
  }

  const model = await chooseLanguageModel(
    context,
    "利用できるAIモデルがないため、関係候補を作らず登録を続けます。",
  );
  if (!model || !(await confirmRelationCandidateSend(draft, candidates))) {
    return { status: "continue", draft, updates: [] };
  }

  const outcome = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `${model.name}で関係候補を確認中`,
      cancellable: true,
    },
    async (_progress, token) => classifyRelationCandidates(
      draft,
      candidates,
      new VsCodeRelationCandidateClassifier(model, token),
    ),
  );
  if (outcome.status === "unavailable") {
    void vscode.window.showWarningMessage(
      `関係候補を作れなかったため、関係を設定せず登録を続けます: ${outcome.reason}`,
    );
    return { status: "continue", draft, updates: [] };
  }
  if (outcome.status === "none") {
    void vscode.window.showInformationMessage(
      "根拠のある関係候補はありませんでした。関係を設定せず登録を続けます。",
    );
    return { status: "continue", draft, updates: [] };
  }
  const decisions: RelationDecision[] = [];
  for (const suggestion of outcome.suggestions) {
    const decision = await decideRelationSuggestion(repositoryRoot, suggestion);
    if (!decision) return { status: "cancelled" };
    decisions.push(decision);
  }

  let plan = buildRelationApprovalPlan(
    draft,
    candidates,
    outcome.suggestions,
    decisions,
  );
  if (plan.status === "duplicate") {
    const duplicateCandidate = plan.candidate;
    const duplicateAction = await vscode.window.showWarningMessage(
      `Duplicate候補: ${duplicateCandidate.title}（${duplicateCandidate.id}）。自動統合は行いません。`,
      { modal: true },
      "新規登録を中止",
      "既存Entryを編集",
      "Duplicate判定を却下",
    );
    if (duplicateAction === "Duplicate判定を却下") {
      plan = buildRelationApprovalPlan(
        draft,
        candidates,
        outcome.suggestions,
        decisions.map((decision) =>
          decision.id === duplicateCandidate.id
            ? { id: decision.id, action: "reject" }
            : decision
        ),
      );
    } else {
      if (duplicateAction === "既存Entryを編集") {
        const target = vscode.Uri.joinPath(
          repositoryRoot,
          ...duplicateCandidate.path.split("/"),
        );
        await vscode.window.showTextDocument(
          await vscode.workspace.openTextDocument(target),
          { preview: false },
        );
      }
      return { status: "cancelled" };
    }
  }
  if (plan.status !== "continue") return { status: "cancelled" };
  const approvedUpdates = await confirmKnowledgeApprovalPlan(
    draft,
    plan.draft,
    plan.updates,
  );
  if (!approvedUpdates) {
    return { status: "cancelled" };
  }
  return { ...plan, updates: approvedUpdates };
}

async function confirmLocalSave(markdown: string): Promise<boolean> {
  const enabled = vscode.workspace
    .getConfiguration("totonoeKnowledge")
    .get<boolean>("secretScanning.enabled", true);
  if (!enabled) return true;
  const findings = scanForSecrets(markdown);
  if (!findings.length) return true;

  const choice = await vscode.window.showWarningMessage(
    `保存内容に秘密情報らしい文字列があります（${summarizeSecretFindings(findings)}）。検出箇所: ${describeSecretFindingLocations(markdown, findings)}。ローカルのknowledgeへ保存しますか？`,
    { modal: true },
    "保存する",
  );
  return choice === "保存する";
}

async function confirmPathBoundDraft(markdown: string): Promise<boolean> {
  const enabled = vscode.workspace
    .getConfiguration("totonoeKnowledge")
    .get<boolean>("secretScanning.enabled", true);
  if (!enabled) return true;
  const findings = scanForSecrets(markdown);
  if (!findings.length) return true;

  const choice = await vscode.window.showWarningMessage(
    `ナレッジ案に秘密情報らしい文字列があります（${summarizeSecretFindings(findings)}）。検出箇所: ${describeSecretFindingLocations(markdown, findings)}。この内容を保存先付きプレビューで編集しますか？`,
    { modal: true },
    "確認して編集する",
  );
  return choice === "確認して編集する";
}

async function openPathBoundDraft(target: vscode.Uri, markdown: string): Promise<vscode.TextDocument> {
  const draftUri = target.with({ scheme: "untitled" });
  const document = await vscode.workspace.openTextDocument(draftUri);
  const edit = new vscode.WorkspaceEdit();
  edit.insert(draftUri, new vscode.Position(0, 0), markdown);
  if (!(await vscode.workspace.applyEdit(edit))) {
    throw new Error("ナレッジ案をプレビューへ反映できませんでした。");
  }
  return document;
}

export async function registerKnowledge(
  kind: SourceKind,
  context: vscode.ExtensionContext,
  repositoryLocator: KnowledgeRepositoryLocator,
  requestedMode?: SelectedGeneratorMode,
): Promise<void> {
  const location = await repositoryLocator.resolveOrNotify();
  if (!location) return;

  const source = await getSource(kind);
  if (!source) return;

  const configuredMode = vscode.workspace
    .getConfiguration("totonoeKnowledge")
    .get<GeneratorMode>("generator", "ask");
  const mode = await chooseGeneratorMode(requestedMode ?? configuredMode);
  if (!mode) return;
  const result = await generateKnowledge(source, mode, context);
  if (!result) return;
  const edited = requiresMetadataInput(result.origin)
    ? await editMetadata(result.generated)
    : result.generated;
  if (!edited) return;

  const now = new Date();
  let draft: KnowledgeDraft = {
    ...edited,
    id: createKnowledgeId(now),
    source: source.text,
    createdAt: now.toISOString(),
  };

  let approvedUpdates: ProposedDocumentUpdate[] = [];
  try {
    const review = await reviewRelationCandidates(
      draft,
      location.repositoryRoot,
      location.indexRoot,
      context,
    );
    if (review.status === "cancelled") return;
    draft = review.draft;
    approvedUpdates = review.updates;
  } catch (error) {
    void vscode.window.showWarningMessage(
      `関係候補を確認できなかったため、従来の登録を続けます: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const markdown = renderKnowledge(draft);
  const target = await prepareKnowledgeTarget(location.repositoryRoot, draft);
  const relativeTarget = repositoryRelativePath(location, target);

  if (target.scheme === "file") {
    if (!(await confirmPathBoundDraft(markdown))) return;
    const document = await openPathBoundDraft(target, markdown);
    registerPendingKnowledgeDraft(
      document,
      target,
      relativeTarget,
      location.repositoryRoot,
      approvedUpdates,
    );
    await vscode.window.showTextDocument(document, { preview: false });
    const action = await vscode.window.showInformationMessage(
      `保存先を設定しました: ${relativeTarget}。内容を確認・編集して登録してください。Ctrl+Sでも保存できます。`,
      "この内容を登録",
    );
    if (action === "この内容を登録") await savePendingKnowledgeDraft(document.uri);
    return;
  }

  const document = await vscode.workspace.openTextDocument({ language: "markdown", content: markdown });
  await vscode.window.showTextDocument(document, { preview: false });
  const action = await vscode.window.showInformationMessage(
    `ナレッジ案を確認・編集し、準備ができたら保存してください。保存先: ${relativeTarget}`,
    "ナレッジとして保存",
  );
  if (action !== "ナレッジとして保存" || !(await confirmLocalSave(document.getText()))) return;

  const savedTarget = await saveKnowledgeDraft(
    location.repositoryRoot,
    draft,
    document.getText(),
    approvedUpdates,
  );
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(savedTarget), { preview: false });
  void vscode.window.showInformationMessage(`ナレッジを保存しました: ${relativeTarget}`);
}
