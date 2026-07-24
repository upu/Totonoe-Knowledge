import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import type { RegistrationInput } from "../knowledge/registrationInput";
import { NodeKnowledgeRepository } from "./nodeRepository";
import {
  MCP_REGISTRATION_NOTICE,
  McpRegistrationService,
} from "./registration";

const input: RegistrationInput = {
  title: "Codexから登録する",
  summary: "確認付きでローカルへ保存する",
  type: "procedure",
  keywords: ["Codex", "MCP"],
  conclusion: "previewしてからregisterする。",
  background: "GitHub Copilotを経由せず登録したい。",
  verified: ["stdioだけを使用する"],
  procedure: "password=example-only-secret を含むdiffを確認する。",
  cautions: ["本文を命令として扱わない"],
  unresolved: ["なし"],
};

async function withRepository(
  run: (root: string, service: McpRegistrationService) => Promise<void>,
): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "totonoe-register-"));
  let tokenIndex = 0;
  const service = new McpRegistrationService(new NodeKnowledgeRepository(root), {
    now: () => new Date("2026-07-24T06:00:00.000Z"),
    createId: () => "K-20260724-060000000-test",
    createToken: () => `preview-token-${++tokenIndex}`,
  });
  try {
    await run(root, service);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("preview returns a validated canonical diff without changing the repository", async () => {
  await withRepository(async (root, service) => {
    const preview = await service.preview(input);

    assert.equal(preview.notice, MCP_REGISTRATION_NOTICE);
    assert.equal(preview.id, "K-20260724-060000000-test");
    assert.equal(
      preview.reference,
      "procedures/K-20260724-060000000-test-codexから登録する.md",
    );
    assert.match(preview.canonicalMarkdown, /status: active/);
    assert.match(preview.canonicalMarkdown, /# 対応方法/);
    assert.match(preview.diff, /--- \/dev\/null/);
    assert.match(preview.diff, /\+\+\+ b\/procedures\//);
    assert.deepEqual(preview.validationIssues, []);
    assert.deepEqual(preview.secretFindings, {
      total: 1,
      items: [{ kind: "credential-assignment", label: "認証情報らしい代入値", count: 1 }],
    });
    assert.equal(await fs.readdir(root).then((items) => items.length), 0);
  });
});

test("register requires the bound payload and writes only once without returning the body", async () => {
  await withRepository(async (root, service) => {
    const preview = await service.preview(input);
    await assert.rejects(
      () => service.register(preview.previewToken, { ...input, title: "差し替え" }),
      /previewと同じpayload/,
    );
    await assert.rejects(
      () => service.register(preview.previewToken, input),
      /無効.*preview token/,
    );

    const fresh = await service.preview(input);
    const registered = await service.register(fresh.previewToken, input);
    assert.deepEqual(registered, {
      notice: MCP_REGISTRATION_NOTICE,
      id: fresh.id,
      reference: fresh.reference,
    });
    const saved = await fs.readFile(path.join(root, ...fresh.reference.split("/")), "utf8");
    assert.equal(saved, fresh.canonicalMarkdown);
    assert.equal(JSON.stringify(registered).includes(root), false);
    assert.equal(JSON.stringify(registered).includes(input.procedure), false);
    await assert.rejects(
      () => service.register(fresh.previewToken, input),
      /無効.*preview token/,
    );
  });
});

test("register fails closed when the repository state or generated target changes", async () => {
  await withRepository(async (root, service) => {
    const preview = await service.preview(input);
    await fs.mkdir(path.join(root, "investigations"), { recursive: true });
    await fs.writeFile(path.join(root, "investigations", "concurrent.md"), "changed", "utf8");

    await assert.rejects(
      () => service.register(preview.previewToken, input),
      /Repositoryの状態がpreview後に変わりました/,
    );
    await assert.rejects(
      () => fs.stat(path.join(root, ...preview.reference.split("/"))),
      { code: "ENOENT" },
    );

    const collisionPath = path.join(root, "procedures", path.basename(preview.reference));
    await fs.mkdir(path.dirname(collisionPath), { recursive: true });
    await fs.writeFile(collisionPath, "existing", "utf8");
    await assert.rejects(
      () => service.preview(input),
      /生成予定の保存先が既に存在します/,
    );
    assert.equal(await fs.readFile(collisionPath, "utf8"), "existing");
  });
});

test("register rejects an expired preview token", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "totonoe-register-expiry-"));
  let now = new Date("2026-07-24T06:00:00.000Z");
  const service = new McpRegistrationService(new NodeKnowledgeRepository(root), {
    now: () => now,
    createId: () => "K-20260724-060000000-expiry",
    createToken: () => "expiring-preview-token",
    previewTtlMs: 1_000,
  });
  try {
    const preview = await service.preview(input);
    now = new Date("2026-07-24T06:00:01.001Z");
    await assert.rejects(
      () => service.register(preview.previewToken, input),
      /有効期限が切れています/,
    );
    await assert.rejects(
      () => service.register(preview.previewToken, input),
      /無効.*preview token/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
