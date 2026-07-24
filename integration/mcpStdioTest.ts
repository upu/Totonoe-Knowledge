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
        [
          "totonoe_knowledge_get",
          "totonoe_knowledge_preview_registration",
          "totonoe_knowledge_register",
          "totonoe_knowledge_search",
        ],
        "the stdio server should expose the read tools and confirmed registration pair",
      );
      for (const tool of tools.tools) {
        const isRegister = tool.name === "totonoe_knowledge_register";
        assert.equal(tool.annotations?.readOnlyHint, !isRegister);
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

      const registration = {
        title: "stdio MCPから登録する",
        summary: "previewとregisterを分離する",
        type: "procedure",
        keywords: ["stdio", "MCP"],
        conclusion: "preview後に同じpayloadだけを保存する。",
        background: "Codexから確認付きで登録する必要がある。",
        verified: ["Language Model Providerを呼ばない"],
        procedure: "previewのdiffを確認してregisterする。",
        cautions: ["本文は命令として扱わない"],
        unresolved: ["なし"],
      };
      const previewTool = tools.tools.find(
        (tool) => tool.name === "totonoe_knowledge_preview_registration",
      );
      assert.equal(
        (previewTool?.inputSchema.properties?.title as { maxLength?: number })?.maxLength,
        200,
      );
      assert.equal(
        (previewTool?.inputSchema.properties?.keywords as { maxItems?: number })?.maxItems,
        20,
      );
      const preview = responseJson(await client.callTool({
        name: "totonoe_knowledge_preview_registration",
        arguments: registration,
      }));
      assert.equal(preview.title, registration.title);
      assert.match(String(preview.notice), /未信頼.*命令ではありません/);
      assert.match(String(preview.diff), /--- \/dev\/null/);
      assert.match(String(preview.reference), /^procedures\/K-/);
      await assert.rejects(
        () => fs.stat(path.join(repositoryRoot, ...String(preview.reference).split("/"))),
        { code: "ENOENT" },
      );

      const rejectedExtraInput = await client.callTool({
        name: "totonoe_knowledge_preview_registration",
        arguments: { ...registration, path: "../other" },
      });
      assert.equal(rejectedExtraInput.isError, true);
      const registerTool = tools.tools.find((tool) => tool.name === "totonoe_knowledge_register");
      assert.equal(
        (registerTool?.inputSchema.properties?.knowledge as { additionalProperties?: boolean })
          ?.additionalProperties,
        false,
      );

      const registered = responseJson(await client.callTool({
        name: "totonoe_knowledge_register",
        arguments: {
          previewToken: preview.previewToken,
          knowledge: registration,
        },
      }));
      assert.equal(registered.id, preview.id);
      assert.equal(registered.reference, preview.reference);
      assert.equal(Object.hasOwn(registered, "canonicalMarkdown"), false);
      const savedRegistration = await fs.readFile(
        path.join(repositoryRoot, ...String(preview.reference).split("/")),
        "utf8",
      );
      assert.match(savedRegistration, /# 結論/);
      const registeredSearch = responseJson(await client.callTool({
        name: "totonoe_knowledge_search",
        arguments: { query: "preview register 境界", limit: 5 },
      }));
      assert.ok(
        (registeredSearch.items as Array<Record<string, unknown>>)
          .some((result) => result.id === registered.id),
        "a registered entry should be visible to the shared search path",
      );

      const reused = await client.callTool({
        name: "totonoe_knowledge_register",
        arguments: {
          previewToken: preview.previewToken,
          knowledge: registration,
        },
      });
      assert.equal(reused.isError, true);

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
