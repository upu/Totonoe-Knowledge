import * as vscode from "vscode";
import { frontmatterString, parseFrontmatter } from "./frontmatter";
import { knowledgeDirectories } from "./markdown";

async function readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
  try {
    return await vscode.workspace.fs.readDirectory(uri);
  } catch (error) {
    if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") return [];
    throw error;
  }
}

async function collectMarkdownFiles(directory: vscode.Uri): Promise<vscode.Uri[]> {
  const files: vscode.Uri[] = [];
  for (const [name, type] of await readDirectory(directory)) {
    const uri = vscode.Uri.joinPath(directory, name);
    if ((type & vscode.FileType.SymbolicLink) !== 0) continue;
    if ((type & vscode.FileType.Directory) !== 0) {
      files.push(...await collectMarkdownFiles(uri));
      continue;
    }
    if ((type & vscode.FileType.File) !== 0 && name.toLowerCase().endsWith(".md")) files.push(uri);
  }
  return files;
}

async function collectLegacyRootFiles(repositoryRoot: vscode.Uri): Promise<vscode.Uri[]> {
  const files: vscode.Uri[] = [];
  for (const [name, type] of await readDirectory(repositoryRoot)) {
    if ((type & (vscode.FileType.Directory | vscode.FileType.SymbolicLink)) !== 0) continue;
    if ((type & vscode.FileType.File) === 0 || !name.toLowerCase().endsWith(".md")) continue;
    const uri = vscode.Uri.joinPath(repositoryRoot, name);
    const content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
    const id = frontmatterString(parseFrontmatter(content), "id");
    if (/^K-/i.test(id ?? "")) files.push(uri);
  }
  return files;
}

export async function findKnowledgeMarkdownFiles(repositoryRoot: vscode.Uri): Promise<vscode.Uri[]> {
  const files = await Promise.all([
    collectLegacyRootFiles(repositoryRoot),
    ...knowledgeDirectories.map((directory) =>
      collectMarkdownFiles(vscode.Uri.joinPath(repositoryRoot, directory)),
    ),
  ]);
  return files.flat().sort((left, right) => left.toString().localeCompare(right.toString()));
}
