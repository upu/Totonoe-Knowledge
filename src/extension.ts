import * as vscode from "vscode";
import { rebuildSearchIndex } from "./commands/rebuildSearchIndex";
import {
  generateCurrentView,
  markCurrentViewAffected,
  showCurrentViewLinks,
} from "./commands/currentView";
import { registerKnowledge } from "./commands/registerKnowledge";
import { searchKnowledge } from "./commands/searchKnowledge";
import {
  clearPendingKnowledgeDraft,
  savePendingKnowledgeDraft,
} from "./commands/saveKnowledgeDraft";
import { validateKnowledgeRepository } from "./commands/validateKnowledge";
import { KnowledgeRepositoryLocator } from "./knowledge/repositoryLocation";
import { SaveKnowledgeTool } from "./tools/saveKnowledgeTool";
import { SearchKnowledgeTool } from "./tools/searchKnowledgeTool";

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection("totonoe-knowledge");
  const repositoryLocator = new KnowledgeRepositoryLocator(context.globalState);
  context.subscriptions.push(
    diagnostics,
    vscode.commands.registerCommand("totonoeKnowledge.registerFromClipboard", () =>
      registerKnowledge("clipboard", context, repositoryLocator),
    ),
    vscode.commands.registerCommand("totonoeKnowledge.registerSelection", () =>
      registerKnowledge("selection", context, repositoryLocator),
    ),
    vscode.commands.registerCommand("totonoeKnowledge.registerFromClipboardWithAi", () =>
      registerKnowledge("clipboard", context, repositoryLocator, "languageModel"),
    ),
    vscode.commands.registerCommand("totonoeKnowledge.registerFromClipboardWithTemplate", () =>
      registerKnowledge("clipboard", context, repositoryLocator, "template"),
    ),
    vscode.commands.registerCommand("totonoeKnowledge.registerSelectionWithAi", () =>
      registerKnowledge("selection", context, repositoryLocator, "languageModel"),
    ),
    vscode.commands.registerCommand("totonoeKnowledge.registerSelectionWithTemplate", () =>
      registerKnowledge("selection", context, repositoryLocator, "template"),
    ),
    vscode.commands.registerCommand("totonoeKnowledge.selectRepository", () =>
      repositoryLocator.selectExternalRepository(),
    ),
    vscode.commands.registerCommand("totonoeKnowledge.showRepository", () =>
      repositoryLocator.showRepository(),
    ),
    vscode.commands.registerCommand("totonoeKnowledge.useWorkspaceRepository", () =>
      repositoryLocator.useWorkspaceRepository(),
    ),
    vscode.commands.registerCommand("totonoeKnowledge.search", () => searchKnowledge(repositoryLocator)),
    vscode.commands.registerCommand("totonoeKnowledge.searchForVersion", () =>
      searchKnowledge(repositoryLocator, true),
    ),
    vscode.commands.registerCommand("totonoeKnowledge.generateCurrentView", () =>
      generateCurrentView(context, repositoryLocator),
    ),
    vscode.commands.registerCommand("totonoeKnowledge.showCurrentViewLinks", () =>
      showCurrentViewLinks(repositoryLocator),
    ),
    vscode.commands.registerCommand("totonoeKnowledge.markCurrentViewAffected", () =>
      markCurrentViewAffected(repositoryLocator),
    ),
    vscode.commands.registerCommand("totonoeKnowledge.saveDraft", () => savePendingKnowledgeDraft()),
    vscode.commands.registerCommand("totonoeKnowledge.rebuildSearchIndex", () =>
      rebuildSearchIndex(repositoryLocator),
    ),
    vscode.commands.registerCommand("totonoeKnowledge.validateRepository", () =>
      validateKnowledgeRepository(diagnostics, repositoryLocator),
    ),
    vscode.lm.registerTool("totonoe-knowledge_saveKnowledge", new SaveKnowledgeTool(repositoryLocator)),
    vscode.lm.registerTool("totonoe-knowledge_searchKnowledge", new SearchKnowledgeTool(repositoryLocator)),
    vscode.workspace.onDidSaveTextDocument(clearPendingKnowledgeDraft),
  );
}

export function deactivate(): void {}
