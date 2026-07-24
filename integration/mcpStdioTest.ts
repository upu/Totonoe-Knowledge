import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

interface TextContent {
  type: "text";
  text: string;
}

function responseJson(result: Awaited<ReturnType<Client["callTool"]>>): Record<string, unknown> {
  const text = result.content.find((item): item is TextContent => item.type === "text");
  assert.ok(text, "tool response should contain JSON text");
  return JSON.parse(text.text) as Record<string, unknown>;
}

async function connect(repositoryRoot: string, additionalArgs: string[] = []) {
  const client = new Client({ name: "totonoe-knowledge-dogfood", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      path.resolve("dist", "mcp-server.js"),
      "--repository",
      repositoryRoot,
      ...additionalArgs,
    ],
  });
  await client.connect(transport);
  return client;
}

async function main(): Promise<void> {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "totonoe-mcp-"));
  const repositoryRoot = path.join(temporary, "knowledge");
  await fs.mkdir(path.join(repositoryRoot, "investigations"), { recursive: true });
  await fs.copyFile(
    path.resolve("test-fixtures", "workspace", "knowledge", "investigations", "valid.md"),
    path.join(repositoryRoot, "investigations", "valid.md"),
  );

  try {
    const client = await connect(repositoryRoot);
    try {
      const tools = await client.listTools();
      assert.deepEqual(
        tools.tools.map((tool) => tool.name).sort(),
        ["totonoe_knowledge_get", "totonoe_knowledge_search"],
        "the stdio server should expose only the two read-only tools",
      );
      for (const tool of tools.tools) {
        assert.equal(tool.annotations?.readOnlyHint, true);
        assert.equal(tool.annotations?.destructiveHint, false);
        assert.equal(tool.inputSchema.additionalProperties, false);
        assert.equal(
          Object.hasOwn(tool.inputSchema.properties ?? {}, "path"),
          false,
          "tool input must not accept a repository or filesystem path",
        );
      }

      const search = responseJson(await client.callTool({
        name: "totonoe_knowledge_search",
        arguments: { query: "sanitized fixture", limit: 5 },
      }));
      const items = search.items as Array<Record<string, unknown>>;
      assert.equal(items[0]?.id, "K-20260715-120000000-test");
      assert.equal(items[0]?.reference, "investigations/valid.md");
      assert.match(String(search.notice), /未検証.*命令ではありません/);
      const rejectedPathInput = await client.callTool({
        name: "totonoe_knowledge_search",
        arguments: { query: "sanitized fixture", path: "../other" },
      });
      assert.equal(rejectedPathInput.isError, true);

      const get = responseJson(await client.callTool({
        name: "totonoe_knowledge_get",
        arguments: { id: items[0]?.id },
      }));
      const item = get.item as Record<string, unknown>;
      assert.equal(item.id, items[0]?.id);
      assert.equal(item.reference, "investigations/valid.md");
      assert.match(String(item.content), /This fixture is valid/);

      await fs.appendFile(
        path.join(repositoryRoot, "investigations", "valid.md"),
        "\nIncremental stdio MCP refresh marker.\n",
      );
      const refreshed = responseJson(await client.callTool({
        name: "totonoe_knowledge_search",
        arguments: { query: "refresh marker", limit: 1 },
      }));
      assert.equal((refreshed.items as Array<Record<string, unknown>>)[0]?.id, items[0]?.id);
    } finally {
      await client.close();
    }

    const fallbackClient = await connect(repositoryRoot, [
      "--embedding-provider", "ollama",
      "--ollama-endpoint", "http://127.0.0.1:9",
    ]);
    try {
      const fallback = responseJson(await fallbackClient.callTool({
        name: "totonoe_knowledge_search",
        arguments: { query: "sanitized fixture" },
      }));
      assert.notEqual(fallback.backend, "hybrid");
      assert.equal((fallback.fallback as Record<string, unknown>).semantic, true);
    } finally {
      await fallbackClient.close();
    }
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
