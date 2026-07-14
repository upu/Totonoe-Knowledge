import type { GeneratedKnowledge, KnowledgeSource } from "../knowledge/types";

export interface KnowledgeGenerator {
  readonly id: "template" | "languageModel";
  generate(source: KnowledgeSource): Promise<GeneratedKnowledge>;
}
