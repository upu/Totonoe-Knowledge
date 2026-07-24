import {
  frontmatterList,
  frontmatterString,
  parseFrontmatter,
} from "../knowledge/frontmatter";
import {
  knowledgeTypes,
  type GeneratedKnowledge,
  type KnowledgeType,
} from "../knowledge/types";
import { normalizeRegistrationInput } from "../knowledge/registrationInput";

const preparedKnowledgeVersion = "1";
const sectionNames = [
  "結論",
  "背景",
  "確認したこと",
  "対応方法",
  "注意点",
  "未解決事項",
] as const;

type SectionName = (typeof sectionNames)[number];

function parseSections(body: string): Partial<Record<SectionName, string>> {
  const matches = [...body.matchAll(/^#\s+(.+?)\s*$/gm)];
  const sections: Partial<Record<SectionName, string>> = {};
  for (let index = 0; index < matches.length; index += 1) {
    const name = matches[index][1].trim();
    if (!sectionNames.includes(name as SectionName)) continue;
    if (Object.hasOwn(sections, name)) throw preparedSourceError(`見出しが重複しています: ${name}`);
    const start = (matches[index].index ?? 0) + matches[index][0].length;
    const end = matches[index + 1]?.index ?? body.length;
    sections[name as SectionName] = body.slice(start, end).trim();
  }
  return sections;
}

function parseList(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*[-*]\s+(.+?)\s*$/)?.[1])
    .filter((line): line is string => Boolean(line));
}

function preparedSourceError(message: string): Error {
  return new Error(`構造化済みナレッジを読み込めません: ${message}`);
}

export function parsePreparedKnowledgeSource(text: string): GeneratedKnowledge | undefined {
  const parsed = parseFrontmatter(text);
  if (!Object.hasOwn(parsed.values, "prepared_knowledge")) return undefined;
  if (frontmatterString(parsed, "prepared_knowledge") !== preparedKnowledgeVersion) {
    throw preparedSourceError(`prepared_knowledgeは"${preparedKnowledgeVersion}"を指定してください。`);
  }
  if (parsed.duplicateKeys.length) {
    throw preparedSourceError(`front matterのkeyが重複しています: ${parsed.duplicateKeys.map(({ key }) => key).join(", ")}`);
  }

  const title = frontmatterString(parsed, "title")?.trim();
  const summary = frontmatterString(parsed, "summary")?.trim();
  const type = frontmatterString(parsed, "type")?.trim();
  const keywords = frontmatterList(parsed, "keywords");
  if (!title) throw preparedSourceError("front matterのtitleが必要です。");
  if (!summary) throw preparedSourceError("front matterのsummaryが必要です。");
  if (!type || !knowledgeTypes.includes(type as KnowledgeType)) {
    throw preparedSourceError(`typeは${knowledgeTypes.join(", ")}のいずれかで指定してください。`);
  }
  if (!keywords) throw preparedSourceError("front matterのkeywordsをリストで指定してください。");
  const normalizedKeywords = keywords.map((value) => value.trim()).filter(Boolean);
  if (!normalizedKeywords.length) throw preparedSourceError("keywordsには1つ以上の値が必要です。");

  const sections = parseSections(parsed.body);
  const missing = sectionNames.filter((name) => sections[name] === undefined);
  if (missing.length) throw preparedSourceError(`見出しが不足しています: ${missing.join(", ")}`);

  try {
    return normalizeRegistrationInput({
      title,
      summary,
      type: type as KnowledgeType,
      keywords: normalizedKeywords,
      conclusion: sections["結論"] ?? "",
      background: sections["背景"] ?? "",
      verified: parseList(sections["確認したこと"] ?? ""),
      procedure: sections["対応方法"] ?? "",
      cautions: parseList(sections["注意点"] ?? ""),
      unresolved: parseList(sections["未解決事項"] ?? ""),
    });
  } catch (error) {
    throw preparedSourceError(error instanceof Error ? error.message : String(error));
  }
}
