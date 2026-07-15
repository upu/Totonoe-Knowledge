import * as vscode from "vscode";
import { createKnowledgeId } from "../knowledge/id";
import { saveKnowledgeDraft } from "../knowledge/repository";
import {
  KnowledgeRepositoryLocator,
  repositoryRelativePath,
} from "../knowledge/repositoryLocation";
import { knowledgeTypes, type KnowledgeDraft, type KnowledgeType } from "../knowledge/types";
import {
  compareVersionStrings,
  describeVersionRange,
  parseComparableVersion,
} from "../knowledge/versioning";
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
  appliesFrom?: string;
  appliesTo?: string;
  relatedKnowledgeIds?: string[];
  supersedesKnowledgeIds?: string[];
  sourceReferences?: string[];
}

function validateInput(input: SaveKnowledgeInput): void {
  if (!input.title.trim()) throw new Error("titleは必須です。");
  if (!knowledgeTypes.includes(input.type)) throw new Error(`未対応のtypeです: ${input.type}`);
  if (input.appliesFrom !== undefined && typeof input.appliesFrom !== "string") {
    throw new Error("appliesFromは文字列で指定してください。");
  }
  if (input.appliesTo !== undefined && typeof input.appliesTo !== "string") {
    throw new Error("appliesToは文字列で指定してください。");
  }
  const appliesFrom = input.appliesFrom?.trim();
  const appliesTo = input.appliesTo?.trim();
  if (appliesFrom && !parseComparableVersion(appliesFrom)) {
    throw new Error(`appliesFromは比較可能な版表記で指定してください: ${appliesFrom}`);
  }
  if (appliesTo && !parseComparableVersion(appliesTo)) {
    throw new Error(`appliesToは比較可能な版表記で指定してください: ${appliesTo}`);
  }
  if (appliesFrom && appliesTo) {
    const comparison = compareVersionStrings(appliesFrom, appliesTo);
    if (comparison === undefined) throw new Error("appliesFromとappliesToの製品系列が一致しません。");
    if (comparison > 0) throw new Error("appliesFromはappliesTo以前である必要があります。");
  }
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
  constructor(private readonly repositoryLocator: KnowledgeRepositoryLocator) {}

  prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<SaveKnowledgeInput>,
  ): vscode.PreparedToolInvocation {
    const findings = scanForSecrets(JSON.stringify(options.input));
    const warning = findings.length
      ? `\n\n⚠️ 秘密情報らしい文字列: ${summarizeSecretFindings(findings)}`
      : "";
    const applicability = describeVersionRange(options.input.appliesFrom, options.input.appliesTo);
    const supersedes = options.input.supersedesKnowledgeIds?.length
      ? options.input.supersedesKnowledgeIds.join(", ")
      : "なし";
    return {
      invocationMessage: `「${options.input.title}」をナレッジとして保存しています`,
      confirmationMessages: {
        title: "Totonoe Knowledgeへ保存しますか？",
        message: `タイトル: **${options.input.title}**\n\n適用バージョン: **${applicability}**\n\n置き換えるEntry: **${supersedes}**\n\n選択中のTotonoe KnowledgeリポジトリへMarkdownを作成します。${warning}`,
      },
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<SaveKnowledgeInput>,
    token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    if (token.isCancellationRequested) throw new vscode.CancellationError();
    validateInput(options.input);

    const location = await this.repositoryLocator.resolve();

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
      appliesFrom: input.appliesFrom?.trim(),
      appliesTo: input.appliesTo?.trim(),
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
    const target = await saveKnowledgeDraft(location.repositoryRoot, draft);
    const relativePath = repositoryRelativePath(location, target);
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(
        `ナレッジ ${draft.id} を保存しました。タイトル: ${draft.title}。ファイル: ${relativePath}`,
      ),
    ]);
  }
}
