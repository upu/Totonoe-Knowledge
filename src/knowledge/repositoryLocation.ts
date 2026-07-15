import * as path from "node:path";
import * as vscode from "vscode";
import { isValidRepositoryPath } from "./repositoryPath";
import {
  decodeRepositorySelection,
  type StoredRepositorySelection,
} from "./repositorySelection";

const selectionStorageKey = "totonoeKnowledge.repositorySelection";

export interface KnowledgeRepositoryLocation {
  repositoryRoot: vscode.Uri;
  indexRoot: vscode.Uri;
  kind: "workspace" | "external";
}

function displayUri(uri: vscode.Uri): string {
  return uri.scheme === "file" ? uri.fsPath : uri.toString(true);
}

export function repositoryRelativePath(
  location: KnowledgeRepositoryLocation,
  uri: vscode.Uri,
): string {
  return path.posix.relative(location.repositoryRoot.path, uri.path);
}

export function describeRepositoryLocation(location: KnowledgeRepositoryLocation): string {
  const source = location.kind === "external" ? "選択した外部フォルダー" : "ワークスペース内";
  return `${source}: ${displayUri(location.repositoryRoot)}`;
}

export class KnowledgeRepositoryLocator {
  constructor(private readonly state: vscode.Memento) {}

  private storedSelection(): StoredRepositorySelection | undefined {
    const value = this.state.get<unknown>(selectionStorageKey);
    if (value === undefined) return undefined;
    const selection = decodeRepositorySelection(value);
    if (!selection) {
      throw new Error(
        "保存されたナレッジリポジトリ選択が壊れています。Use Workspace Repositoryで解除してから選び直してください。",
      );
    }
    return selection;
  }

  private workspaceLocation(): KnowledgeRepositoryLocation {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      throw new Error(
        "ナレッジリポジトリのフォルダーを選択するか、保存先となるワークスペースを開いてください。",
      );
    }
    const repositoryPath = vscode.workspace
      .getConfiguration("totonoeKnowledge")
      .get<string>("repositoryPath", "knowledge")
      .trim();
    if (!isValidRepositoryPath(repositoryPath)) {
      throw new Error("repositoryPathにはワークスペース内の相対パスを指定してください。");
    }
    return {
      repositoryRoot: vscode.Uri.joinPath(folder.uri, repositoryPath),
      indexRoot: folder.uri,
      kind: "workspace",
    };
  }

  async resolve(): Promise<KnowledgeRepositoryLocation> {
    const selection = this.storedSelection();
    if (!selection) return this.workspaceLocation();

    const repositoryRoot = vscode.Uri.parse(selection.uri, true);
    let stat: vscode.FileStat;
    try {
      stat = await vscode.workspace.fs.stat(repositoryRoot);
    } catch (error) {
      throw new Error(
        `選択したナレッジリポジトリへアクセスできません: ${displayUri(repositoryRoot)}。Select Knowledge Repository Folderで選び直してください。`,
        { cause: error },
      );
    }
    if ((stat.type & vscode.FileType.Directory) === 0) {
      throw new Error(
        `選択したナレッジリポジトリはフォルダーではありません: ${displayUri(repositoryRoot)}`,
      );
    }
    return { repositoryRoot, indexRoot: repositoryRoot, kind: "external" };
  }

  async resolveOrNotify(): Promise<KnowledgeRepositoryLocation | undefined> {
    try {
      return await this.resolve();
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      return undefined;
    }
  }

  async selectExternalRepository(): Promise<void> {
    if (!vscode.workspace.isTrusted) {
      void vscode.window.showErrorMessage("信頼済みワークスペースでナレッジリポジトリを選択してください。");
      return;
    }
    let current: vscode.Uri | undefined;
    try {
      const selection = this.storedSelection();
      current = selection ? vscode.Uri.parse(selection.uri, true) : undefined;
    } catch {
      // A new explicit selection can repair corrupt stored state.
    }
    const selected = await vscode.window.showOpenDialog({
      title: "Totonoe Knowledgeリポジトリを選択",
      defaultUri: current ?? vscode.workspace.workspaceFolders?.[0]?.uri,
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "ナレッジリポジトリとして選択",
    });
    const repositoryRoot = selected?.[0];
    if (!repositoryRoot) return;

    let stat: vscode.FileStat;
    try {
      stat = await vscode.workspace.fs.stat(repositoryRoot);
    } catch (error) {
      void vscode.window.showErrorMessage(
        `選択したフォルダーへアクセスできません: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    if ((stat.type & vscode.FileType.Directory) === 0) {
      void vscode.window.showErrorMessage("ナレッジリポジトリにはフォルダーを選択してください。");
      return;
    }
    const action = await vscode.window.showWarningMessage(
      `次のフォルダーを登録・検索・整合性検査に使用し、.totonoe/index.sqliteを作成します。\n\n${displayUri(repositoryRoot)}`,
      { modal: true },
      "このフォルダーを使用",
    );
    if (action !== "このフォルダーを使用") return;

    await this.state.update(selectionStorageKey, {
      version: 1,
      uri: repositoryRoot.toString(),
    } satisfies StoredRepositorySelection);
    void vscode.window.showInformationMessage(
      `Totonoe Knowledgeリポジトリを変更しました: ${displayUri(repositoryRoot)}`,
    );
  }

  async useWorkspaceRepository(): Promise<void> {
    let location: KnowledgeRepositoryLocation;
    try {
      location = this.workspaceLocation();
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      return;
    }
    await this.state.update(selectionStorageKey, undefined);
    void vscode.window.showInformationMessage(
      `ワークスペース内のナレッジリポジトリへ戻しました: ${displayUri(location.repositoryRoot)}`,
    );
  }

  async showRepository(): Promise<void> {
    const location = await this.resolveOrNotify();
    if (!location) return;
    const actions = location.kind === "external"
      ? ["別のフォルダーを選択", "ワークスペース内へ戻す"]
      : ["別のフォルダーを選択"];
    const action = await vscode.window.showInformationMessage(
      `現在のTotonoe Knowledgeリポジトリ\n${describeRepositoryLocation(location)}`,
      ...actions,
    );
    if (action === "別のフォルダーを選択") await this.selectExternalRepository();
    if (action === "ワークスペース内へ戻す") await this.useWorkspaceRepository();
  }
}
