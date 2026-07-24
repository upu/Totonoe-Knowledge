import * as vscode from "vscode";
import type {
  CurrentViewSource,
  GeneratedCurrentView,
} from "../curation/currentView";
import {
  buildCurrentViewPrompt,
  parseCurrentViewResponse,
} from "./currentViewPrompt";

export class VsCodeCurrentViewGenerator {
  constructor(
    private readonly model: vscode.LanguageModelChat,
    private readonly token: vscode.CancellationToken,
  ) {}

  async generate(
    sources: readonly CurrentViewSource[],
    existingTitle?: string,
  ): Promise<GeneratedCurrentView> {
    const prompt = buildCurrentViewPrompt(sources, existingTitle);
    const inputTokens = await this.model.countTokens(prompt, this.token);
    if (inputTokens > Math.floor(this.model.maxInputTokens * 0.8)) {
      throw new Error(
        `Current Viewの根拠がモデルのコンテキスト上限に近すぎます（${inputTokens}/${this.model.maxInputTokens} tokens）。`,
      );
    }
    const response = await this.model.sendRequest(
      [vscode.LanguageModelChatMessage.User(prompt)],
      {
        justification: "選択した根拠Entryから、保存前に編集・承認できるCurrent View案を生成します。",
      },
      this.token,
    );
    let text = "";
    for await (const fragment of response.text) text += fragment;
    return parseCurrentViewResponse(text);
  }
}
