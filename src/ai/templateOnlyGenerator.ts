import type { KnowledgeGenerator } from "./knowledgeGenerator";
import type { GeneratedKnowledge, KnowledgeSource } from "../knowledge/types";

function firstMeaningfulLine(text: string): string {
  const line = text.split(/\r?\n/).map((value) => value.trim()).find(Boolean);
  if (!line) return "新しいナレッジ";
  return line.replace(/^#+\s*/, "").slice(0, 80);
}

export class TemplateOnlyGenerator implements KnowledgeGenerator {
  readonly id = "template" as const;

  async generate(source: KnowledgeSource): Promise<GeneratedKnowledge> {
    return {
      title: firstMeaningfulLine(source.text),
      summary: "",
      type: "investigation",
      keywords: [],
      content: {
        conclusion: "",
        background: "",
        verified: [],
        procedure: "",
        cautions: [],
        unresolved: [],
      },
    };
  }
}
