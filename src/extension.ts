import * as vscode from "vscode";
import { registerKnowledge } from "./commands/registerKnowledge";
import { searchKnowledge } from "./commands/searchKnowledge";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("totonoeKnowledge.registerFromClipboard", () =>
      registerKnowledge("clipboard"),
    ),
    vscode.commands.registerCommand("totonoeKnowledge.registerSelection", () =>
      registerKnowledge("selection"),
    ),
    vscode.commands.registerCommand("totonoeKnowledge.search", searchKnowledge),
  );
}

export function deactivate(): void {}

