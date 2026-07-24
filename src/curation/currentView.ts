import { frontmatterList, parseFrontmatter } from "../knowledge/frontmatter";
import type { ProposedDocumentUpdate } from "../knowledge/documentUpdate";
import type { KnowledgeContent, KnowledgeDraft } from "../knowledge/types";
import { setFrontmatterList } from "./relationApproval";

export interface CurrentViewSource {
  id: string;
  title: string;
  summary: string;
  type: string;
  keywords: string[];
  path: string;
  updatedAt: string;
  content: string;
}

export interface GeneratedCurrentView {
  title: string;
  summary: string;
  keywords: string[];
  content: KnowledgeContent;
}

export interface CurrentViewIdentity {
  id: string;
  createdAt: string;
  appliesFrom?: string;
  appliesTo?: string;
  relatedKnowledgeIds?: string[];
  supersedesKnowledgeIds?: string[];
  conflictKnowledgeIds?: string[];
}

export function buildCurrentViewDraft(
  generated: GeneratedCurrentView,
  sources: readonly CurrentViewSource[],
  now: Date,
  identity: CurrentViewIdentity,
): KnowledgeDraft {
  if (!sources.length) throw new Error("Current Viewには1件以上の根拠Entryが必要です。");
  return {
    ...generated,
    id: identity.id,
    type: "specification",
    source: [
      "Current View sources:",
      ...sources.map((source) => `- ${source.id}: ${source.path}`),
    ].join("\n"),
    createdAt: identity.createdAt,
    updatedAt: now.toISOString(),
    appliesFrom: identity.appliesFrom,
    appliesTo: identity.appliesTo,
    relatedKnowledgeIds: identity.relatedKnowledgeIds,
    supersedesKnowledgeIds: identity.supersedesKnowledgeIds,
    conflictKnowledgeIds: identity.conflictKnowledgeIds,
    consolidatedKnowledgeIds: [...new Set(sources.map((source) => source.id))],
    consolidatedAt: now.toISOString(),
  };
}

export function buildCurrentViewSourceUpdates(
  sources: readonly CurrentViewSource[],
  currentViewId: string,
): ProposedDocumentUpdate[] {
  return sources.flatMap((source) => {
    const parsed = parseFrontmatter(source.content);
    const affects = frontmatterList(parsed, "affects") ?? [];
    if (!affects.includes(currentViewId)) return [];
    return [{
      path: source.path,
      expectedContent: source.content,
      proposedContent: setFrontmatterList(
        source.content,
        "affects",
        affects.filter((id) => id !== currentViewId),
      ),
      reason: `Current View ${currentViewId}へ反映済み`,
    }];
  });
}

export interface CurrentViewLinks {
  sources: CurrentViewSource[];
  currentViews: CurrentViewSource[];
}

export function findCurrentViewLinks(
  entries: readonly CurrentViewSource[],
  activeId: string,
): CurrentViewLinks {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const active = byId.get(activeId);
  const sourceIds = active
    ? frontmatterList(parseFrontmatter(active.content), "consolidates") ?? []
    : [];
  return {
    sources: sourceIds.flatMap((id) => {
      const source = byId.get(id);
      return source ? [source] : [];
    }),
    currentViews: entries.filter((entry) =>
      (frontmatterList(parseFrontmatter(entry.content), "consolidates") ?? [])
        .includes(activeId)
    ),
  };
}
