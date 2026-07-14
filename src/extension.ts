import * as vscode from "vscode";
import { registerKnowledge } from "./commands/registerKnowledge";
import { searchKnowledge } from "./commands/searchKnowledge";
import { SaveKnowledgeTool } from "./tools/saveKnowledgeTool";
import { SearchKnowledgeTool } from "./tools/searchKnowledgeTool";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("totonoeKnowledge.registerFromClipboard", () =>
      registerKnowledge("clipboard"),
    ),
    vscode.commands.registerCommand("totonoeKnowledge.registerSelection", () =>
      registerKnowledge("selection"),
    ),
    vscode.commands.registerCommand("totonoeKnowledge.search", searchKnowledge),
    vscode.lm.registerTool("totonoe-knowledge_saveKnowledge", new SaveKnowledgeTool()),
    vscode.lm.registerTool("totonoe-knowledge_searchKnowledge", new SearchKnowledgeTool()),
  );
}

export function deactivate(): void {}
