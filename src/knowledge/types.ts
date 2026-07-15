export const knowledgeTypes = [
  "investigation",
  "troubleshooting",
  "specification",
  "change",
  "procedure",
  "decision",
] as const;

export type KnowledgeType = (typeof knowledgeTypes)[number];

export interface KnowledgeContent {
  conclusion: string;
  background: string;
  verified: string[];
  procedure: string;
  cautions: string[];
  unresolved: string[];
}

export interface GeneratedKnowledge {
  title: string;
  summary: string;
  type: KnowledgeType;
  keywords: string[];
  content: KnowledgeContent;
}

export interface KnowledgeSource {
  kind: "clipboard" | "selection";
  text: string;
}

export interface KnowledgeDraft extends GeneratedKnowledge {
  id: string;
  source: string;
  createdAt: string;
  appliesFrom?: string;
  appliesTo?: string;
  relatedKnowledgeIds?: string[];
  supersedesKnowledgeIds?: string[];
  sourceReferences?: string[];
}
