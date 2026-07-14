import * as vscode from "vscode";
import type { KnowledgeGenerator } from "../ai/knowledgeGenerator";
import { TemplateOnlyGenerator } from "../ai/templateOnlyGenerator";
import { VsCodeLanguageModelGenerator } from "../ai/vsCodeLanguageModelGenerator";
import { renderKnowledge } from "../knowledge/markdown";
import { createKnowledgeId } from "../knowledge/id";
import { saveKnowledgeDraft } from "../knowledge/repository";
import { isValidRepositoryPath } from "../knowledge/repositoryPath";
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

function workspaceRoot(): vscode.Uri | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

async function chooseGeneratorMode(configured: GeneratorMode): Promise<Exclude<GeneratorMode, "ask"> | undefined> {
  if (configured !== "ask") return configured;
  const selected = await vscode.window.showQuickPick([
    {
      label: "$(sparkle) Language Modelで整える",
      description: "次の画面で選択したVS Codeモデルへ入力を送信",
      mode: "languageModel" as const,
    },
    {
      label: "$(file-text) テンプレートで作る",
      description: "外部送信せず、ローカルで編集可能なひな形を作成",
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
    `入力に秘密情報らしい文字列があります（${summarizeSecretFindings(findings)}）。検出箇所: ${describeSecretFindingLocations(source.text, findings)}。選択したLanguage Modelへ送信しますか？検出には誤りや見逃しがあります。`,
    { modal: true },
    "テンプレートで続ける",
    "理解して送信する",
  );
  if (choice === "理解して送信する") return "send";
  if (choice === "テンプレートで続ける") return "template";
  return undefined;
}

async function chooseLanguageModel(): Promise<vscode.LanguageModelChat | undefined> {
  const models = await vscode.lm.selectChatModels();
  if (!models.length) {
    void vscode.window.showWarningMessage("利用できるLanguage Modelがありません。テンプレート生成へ切り替えます。");
    return undefined;
  }
  const selected = await vscode.window.showQuickPick(
    models.map((model) => ({
      label: model.name,
      description: `${model.vendor} · ${model.family}`,
      detail: model.id,
      model,
    })),
    { title: "ナレッジ生成に使用するLanguage Model", ignoreFocusOut: true },
  );
  return selected?.model;
}

async function generateKnowledge(
  source: KnowledgeSource,
  mode: Exclude<GeneratorMode, "ask">,
): Promise<GeneratedKnowledge | undefined> {
  let generator: KnowledgeGenerator = new TemplateOnlyGenerator();

  if (mode === "languageModel") {
    const sendChoice = await confirmExternalSend(source);
    if (!sendChoice) return undefined;
    if (sendChoice === "send") {
      const model = await chooseLanguageModel();
      if (model) {
        try {
          return await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `${model.name}でナレッジ案を生成中`, cancellable: true },
            async (_progress, token) => new VsCodeLanguageModelGenerator(model, token).generate(source),
          );
        } catch (error) {
          const message = error instanceof vscode.LanguageModelError
            ? `Language Modelを利用できませんでした（${error.code}）。`
            : `ナレッジ案を生成できませんでした: ${error instanceof Error ? error.message : String(error)}`;
          const fallback = await vscode.window.showWarningMessage(message, "テンプレートで続ける");
          if (fallback !== "テンプレートで続ける") return undefined;
        }
      }
    }
  }

  return generator.generate(source);
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

export async function registerKnowledge(kind: SourceKind): Promise<void> {
  const root = workspaceRoot();
  if (!root) {
    void vscode.window.showErrorMessage("ナレッジを保存するワークスペースを開いてください。");
    return;
  }

  const source = await getSource(kind);
  if (!source) return;

  const configuredMode = vscode.workspace
    .getConfiguration("totonoeKnowledge")
    .get<GeneratorMode>("generator", "ask");
  const mode = await chooseGeneratorMode(configuredMode);
  if (!mode) return;
  const generated = await generateKnowledge(source, mode);
  if (!generated) return;
  const edited = await editMetadata(generated);
  if (!edited) return;

  const now = new Date();
  const draft: KnowledgeDraft = {
    ...edited,
    id: createKnowledgeId(now),
    source: source.text,
    createdAt: now.toISOString(),
  };

  const document = await vscode.workspace.openTextDocument({
    language: "markdown",
    content: renderKnowledge(draft),
  });
  await vscode.window.showTextDocument(document, { preview: false });

  const action = await vscode.window.showInformationMessage(
    "ナレッジ案を確認・編集し、準備ができたら保存してください。",
    "knowledge/へ保存",
  );
  if (action !== "knowledge/へ保存" || !(await confirmLocalSave(document.getText()))) return;

  const repositoryPath = vscode.workspace
    .getConfiguration("totonoeKnowledge")
    .get<string>("repositoryPath", "knowledge")
    .trim();
  if (!isValidRepositoryPath(repositoryPath)) {
    void vscode.window.showErrorMessage("repositoryPathにはワークスペース内の相対パスを指定してください。");
    return;
  }

  const target = await saveKnowledgeDraft(root, repositoryPath, draft, document.getText());
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(target), { preview: false });
  void vscode.window.showInformationMessage(`ナレッジを保存しました: ${vscode.workspace.asRelativePath(target)}`);
}
