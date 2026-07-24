import * as vscode from "vscode";
import {
  type RelationCandidate,
  type RelationClassification,
  type RelationClassifier,
} from "../curation/relationCandidates";
import type { KnowledgeDraft } from "../knowledge/types";
import {
  buildRelationCandidatePrompt,
  parseRelationCandidateResponse,
} from "./relationCandidatePrompt";

export class VsCodeRelationCandidateClassifier implements RelationClassifier {
  constructor(
    private readonly model: vscode.LanguageModelChat,
    private readonly token: vscode.CancellationToken,
  ) {}

  async classify(
    draft: KnowledgeDraft,
    candidates: readonly RelationCandidate[],
  ): Promise<readonly RelationClassification[]> {
    const prompt = buildRelationCandidatePrompt(draft, candidates);
    const inputTokens = await this.model.countTokens(prompt, this.token);
    if (inputTokens > Math.floor(this.model.maxInputTokens * 0.8)) {
      throw new Error(
        `関係候補の比較がモデルのコンテキスト上限に近すぎます（${inputTokens}/${this.model.maxInputTokens} tokens）。`,
      );
    }
    const response = await this.model.sendRequest(
      [vscode.LanguageModelChatMessage.User(prompt)],
      {
        justification: "保存前に既存Knowledge Entryとの関係候補を理由・根拠付きで提示します。",
      },
      this.token,
    );
    let text = "";
    for await (const fragment of response.text) text += fragment;
    return parseRelationCandidateResponse(text, candidates);
  }
}
