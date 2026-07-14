import * as vscode from "vscode";
import type { KnowledgeGenerator } from "./knowledgeGenerator";
import { parseLanguageModelResponse } from "./languageModelResponse";
import { buildKnowledgePrompt } from "./promptBuilder";
import type { GeneratedKnowledge, KnowledgeSource } from "../knowledge/types";

export class VsCodeLanguageModelGenerator implements KnowledgeGenerator {
  readonly id = "languageModel" as const;

  constructor(
    private readonly model: vscode.LanguageModelChat,
    private readonly token: vscode.CancellationToken,
  ) {}

  async generate(source: KnowledgeSource): Promise<GeneratedKnowledge> {
    const prompt = buildKnowledgePrompt(source);
    const inputTokens = await this.model.countTokens(prompt, this.token);
    if (inputTokens > Math.floor(this.model.maxInputTokens * 0.8)) {
      throw new Error(
        `入力が選択モデルのコンテキスト上限に近すぎます（${inputTokens}/${this.model.maxInputTokens} tokens）。入力を短くしてください。`,
      );
    }
    const messages = [vscode.LanguageModelChatMessage.User(prompt)];
    const response = await this.model.sendRequest(
      messages,
      { justification: "会話や選択テキストから、保存前に確認できるナレッジ案を生成します。" },
      this.token,
    );

    let text = "";
    for await (const fragment of response.text) text += fragment;
    return parseLanguageModelResponse(text);
  }
}
