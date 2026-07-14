export const knowledgeTypes = [
  "investigation",
  "troubleshooting",
  "specification",
  "change",
  "procedure",
  "decision",
] as const;

export type KnowledgeType = (typeof knowledgeTypes)[number];

export interface KnowledgeDraft {
  id: string;
  title: string;
  summary: string;
  type: KnowledgeType;
  keywords: string[];
  source: string;
  createdAt: string;
}

