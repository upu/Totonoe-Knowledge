import {
  knowledgeTypes,
  type GeneratedKnowledge,
  type KnowledgeContent,
  type KnowledgeType,
} from "../knowledge/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new Error(`生成結果の ${key} が文字列ではありません。`);
  return value.trim();
}

function stringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`生成結果の ${key} が文字列配列ではありません。`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function unwrapJson(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1] ?? trimmed;
}

export function parseLanguageModelResponse(text: string): GeneratedKnowledge {
  let value: unknown;
  try {
    value = JSON.parse(unwrapJson(text));
  } catch {
    throw new Error("Language Modelの応答をJSONとして解析できませんでした。");
  }
  if (!isRecord(value)) throw new Error("生成結果がJSONオブジェクトではありません。");

  const rawType = requiredString(value, "type");
  if (!knowledgeTypes.includes(rawType as KnowledgeType)) {
    throw new Error(`未対応のナレッジ種別です: ${rawType}`);
  }

  const rawContent = value.content;
  if (!isRecord(rawContent)) throw new Error("生成結果の content がオブジェクトではありません。");
  const content: KnowledgeContent = {
    conclusion: requiredString(rawContent, "conclusion"),
    background: requiredString(rawContent, "background"),
    verified: stringArray(rawContent, "verified"),
    procedure: requiredString(rawContent, "procedure"),
    cautions: stringArray(rawContent, "cautions"),
    unresolved: stringArray(rawContent, "unresolved"),
  };

  return {
    title: requiredString(value, "title").slice(0, 120),
    summary: requiredString(value, "summary").slice(0, 300),
    type: rawType as KnowledgeType,
    keywords: stringArray(value, "keywords").slice(0, 20),
    content,
  };
}
