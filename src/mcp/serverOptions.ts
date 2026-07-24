import * as path from "node:path";

export interface McpServerOptions {
  repositoryRoot: string;
  embeddingProvider: "disabled" | "ollama";
  ollamaEndpoint: string;
  ollamaModel: string;
  minimumSimilarity: number;
}

function argumentValue(args: string[], index: number, name: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} の値が必要です。`);
  return value;
}

export function parseServerOptions(args: string[], cwd: string): McpServerOptions {
  let repository: string | undefined;
  let embeddingProvider: McpServerOptions["embeddingProvider"] = "disabled";
  let ollamaEndpoint = "http://127.0.0.1:11434";
  let ollamaModel = "embeddinggemma";
  let minimumSimilarity = -1;
  const seen = new Set<string>();

  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (!name.startsWith("--")) throw new Error(`不明な引数です: ${name}`);
    if (seen.has(name)) throw new Error(`${name} は1回だけ指定してください。`);
    seen.add(name);
    const value = argumentValue(args, index, name);
    index += 1;

    switch (name) {
      case "--repository":
        repository = value;
        break;
      case "--embedding-provider":
        if (value !== "disabled" && value !== "ollama") {
          throw new Error("--embedding-provider は disabled または ollama を指定してください。");
        }
        embeddingProvider = value;
        break;
      case "--ollama-endpoint":
        ollamaEndpoint = value;
        break;
      case "--ollama-model":
        ollamaModel = value.trim();
        if (!ollamaModel) throw new Error("--ollama-model は空にできません。");
        break;
      case "--minimum-similarity": {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < -1 || parsed >= 1) {
          throw new Error("--minimum-similarity は -1 以上 1 未満で指定してください。");
        }
        minimumSimilarity = parsed;
        break;
      }
      default:
        throw new Error(`不明な引数です: ${name}`);
    }
  }

  if (!repository) throw new Error("--repository は必須です。");
  return {
    repositoryRoot: path.resolve(cwd, repository),
    embeddingProvider,
    ollamaEndpoint,
    ollamaModel,
    minimumSimilarity,
  };
}

export const mcpServerUsage = [
  "Usage:",
  "  node dist/mcp-server.js --repository <path> [options]",
  "",
  "Options:",
  "  --embedding-provider disabled|ollama",
  "  --ollama-endpoint <http-loopback-url>",
  "  --ollama-model <model>",
  "  --minimum-similarity <[-1, 1)>",
].join("\n");
