import {
  knowledgeTypes,
  type GeneratedKnowledge,
  type KnowledgeType,
} from "./types";

export interface RegistrationInput {
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
}

function requiredText(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name}に本文が必要です。`);
  }
  return value.trim();
}

function requiredList(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${name}は文字列配列で指定してください。`);
  }
  const normalized = value.map((item) => item.trim()).filter(Boolean);
  if (!normalized.length) throw new Error(`${name}には1つ以上の値が必要です。`);
  return normalized;
}

export function normalizeRegistrationInput(input: RegistrationInput): GeneratedKnowledge {
  const title = requiredText(input.title, "title");
  const summary = requiredText(input.summary, "summary");
  if (!knowledgeTypes.includes(input.type)) {
    throw new Error(`typeは${knowledgeTypes.join(", ")}のいずれかで指定してください。`);
  }

  return {
    title,
    summary,
    type: input.type,
    keywords: requiredList(input.keywords, "keywords"),
    content: {
      conclusion: requiredText(input.conclusion, "結論"),
      background: requiredText(input.background, "背景"),
      verified: requiredList(input.verified, "確認したこと"),
      procedure: requiredText(input.procedure, "対応方法"),
      cautions: requiredList(input.cautions, "注意点"),
      unresolved: requiredList(input.unresolved, "未解決事項"),
    },
  };
}
