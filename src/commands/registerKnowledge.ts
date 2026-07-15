import * as vscode from "vscode";
import { requiresMetadataInput, type GenerationOrigin } from "../ai/generationOrigin";
import { orderModelsByPreviousSelection } from "../ai/modelSelection";
import { TemplateOnlyGenerator } from "../ai/templateOnlyGenerator";
import { VsCodeLanguageModelGenerator } from "../ai/vsCodeLanguageModelGenerator";
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
): Promise<vscode.LanguageModelChat | null | undefined> {
  const models = await vscode.lm.selectChatModels();
  if (!models.length) {
    void vscode.window.showWarningMessage("利用できるAIモデルがありません。入力用テンプレートへ切り替えます。");
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
  const draft: KnowledgeDraft = {
    ...edited,
    id: createKnowledgeId(now),
    source: source.text,
    createdAt: now.toISOString(),
  };

  const markdown = renderKnowledge(draft);
  const target = await prepareKnowledgeTarget(location.repositoryRoot, draft);
  const relativeTarget = repositoryRelativePath(location, target);

  if (target.scheme === "file") {
    if (!(await confirmPathBoundDraft(markdown))) return;
    const document = await openPathBoundDraft(target, markdown);
    await vscode.window.showTextDocument(document, { preview: false });
    void vscode.window.showInformationMessage(
      `保存先を設定しました: ${relativeTarget}。内容を確認・編集し、Ctrl+Sで保存してください。`,
    );
    return;
  }

  const document = await vscode.workspace.openTextDocument({ language: "markdown", content: markdown });
  await vscode.window.showTextDocument(document, { preview: false });
  const action = await vscode.window.showInformationMessage(
    `ナレッジ案を確認・編集し、準備ができたら保存してください。保存先: ${relativeTarget}`,
    "ナレッジとして保存",
  );
  if (action !== "ナレッジとして保存" || !(await confirmLocalSave(document.getText()))) return;

  const savedTarget = await saveKnowledgeDraft(location.repositoryRoot, draft, document.getText());
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(savedTarget), { preview: false });
  void vscode.window.showInformationMessage(`ナレッジを保存しました: ${relativeTarget}`);
}
