import * as vscode from "vscode";
import { createKnowledgeId } from "../knowledge/id";
import { isValidRepositoryPath } from "../knowledge/repositoryPath";
import { saveKnowledgeDraft } from "../knowledge/repository";
import { knowledgeTypes, type KnowledgeDraft, type KnowledgeType } from "../knowledge/types";
import { scanForSecrets, summarizeSecretFindings } from "../security/secretScanner";

export interface SaveKnowledgeInput {
  title: string;
  summary: string;
  type: KnowledgeType;
  keywords: string[];
  conclusion: string;
  background: string;
  verified: string[];
  procedure: string;
  cautions: string[];
  unresolved: string[];
  relatedKnowledgeIds?: string[];
  supersedesKnowledgeIds?: string[];
  sourceReferences?: string[];
}

function validateInput(input: SaveKnowledgeInput): void {
  if (!input.title.trim()) throw new Error("titleは必須です。");
  if (!knowledgeTypes.includes(input.type)) throw new Error(`未対応のtypeです: ${input.type}`);
  for (const [name, value] of Object.entries({
    keywords: input.keywords,
    verified: input.verified,
    cautions: input.cautions,
    unresolved: input.unresolved,
    relatedKnowledgeIds: input.relatedKnowledgeIds ?? [],
    supersedesKnowledgeIds: input.supersedesKnowledgeIds ?? [],
    sourceReferences: input.sourceReferences ?? [],
  })) {
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
      throw new Error(`${name}は文字列配列で指定してください。`);
    }
  }
}

export class SaveKnowledgeTool implements vscode.LanguageModelTool<SaveKnowledgeInput> {
  prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<SaveKnowledgeInput>,
  ): vscode.PreparedToolInvocation {
    const findings = scanForSecrets(JSON.stringify(options.input));
    const warning = findings.length
      ? `\n\n⚠️ 秘密情報らしい文字列: ${summarizeSecretFindings(findings)}`
      : "";
    return {
      invocationMessage: `「${options.input.title}」をナレッジとして保存しています`,
      confirmationMessages: {
        title: "Totonoe Knowledgeへ保存しますか？",
        message: `タイトル: **${options.input.title}**\n\nワークスペースのknowledgeディレクトリへMarkdownを作成します。${warning}`,
      },
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<SaveKnowledgeInput>,
    token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    if (token.isCancellationRequested) throw new vscode.CancellationError();
    validateInput(options.input);

    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root) throw new Error("ナレッジを保存するワークスペースが開かれていません。");
    const repositoryPath = vscode.workspace
      .getConfiguration("totonoeKnowledge")
      .get<string>("repositoryPath", "knowledge")
      .trim();
    if (!isValidRepositoryPath(repositoryPath)) {
      throw new Error("repositoryPathにはワークスペース内の相対パスを指定してください。");
    }

    const now = new Date();
    const input = options.input;
    const draft: KnowledgeDraft = {
      id: createKnowledgeId(now),
      title: input.title.trim(),
      summary: input.summary.trim(),
      type: input.type,
      keywords: input.keywords.map((value) => value.trim()).filter(Boolean),
      createdAt: now.toISOString(),
      source: "VS Code Language Model Toolから登録",
      relatedKnowledgeIds: input.relatedKnowledgeIds?.map((value) => value.trim()).filter(Boolean),
      supersedesKnowledgeIds: input.supersedesKnowledgeIds?.map((value) => value.trim()).filter(Boolean),
      sourceReferences: input.sourceReferences?.map((value) => value.trim()).filter(Boolean),
      content: {
        conclusion: input.conclusion.trim(),
        background: input.background.trim(),
        verified: input.verified.map((value) => value.trim()).filter(Boolean),
        procedure: input.procedure.trim(),
        cautions: input.cautions.map((value) => value.trim()).filter(Boolean),
        unresolved: input.unresolved.map((value) => value.trim()).filter(Boolean),
      },
    };
    const target = await saveKnowledgeDraft(root, repositoryPath, draft);
    const relativePath = vscode.workspace.asRelativePath(target);
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(
        `ナレッジ ${draft.id} を保存しました。タイトル: ${draft.title}。ファイル: ${relativePath}`,
      ),
    ]);
  }
}
