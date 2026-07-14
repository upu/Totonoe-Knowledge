import * as vscode from "vscode";
import { rebuildSearchIndex } from "./commands/rebuildSearchIndex";
import { registerKnowledge } from "./commands/registerKnowledge";
import { searchKnowledge } from "./commands/searchKnowledge";
import { validateKnowledgeRepository } from "./commands/validateKnowledge";
import { SaveKnowledgeTool } from "./tools/saveKnowledgeTool";
import { SearchKnowledgeTool } from "./tools/searchKnowledgeTool";

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection("totonoe-knowledge");
  context.subscriptions.push(
    diagnostics,
    vscode.commands.registerCommand("totonoeKnowledge.registerFromClipboard", () =>
      registerKnowledge("clipboard"),
    ),
    vscode.commands.registerCommand("totonoeKnowledge.registerSelection", () =>
      registerKnowledge("selection"),
    ),
    vscode.commands.registerCommand("totonoeKnowledge.search", searchKnowledge),
    vscode.commands.registerCommand("totonoeKnowledge.rebuildSearchIndex", rebuildSearchIndex),
    vscode.commands.registerCommand("totonoeKnowledge.validateRepository", () =>
      validateKnowledgeRepository(diagnostics),
    ),
    vscode.lm.registerTool("totonoe-knowledge_saveKnowledge", new SaveKnowledgeTool()),
    vscode.lm.registerTool("totonoe-knowledge_searchKnowledge", new SearchKnowledgeTool()),
  );
}

export function deactivate(): void {}
