import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  commandForSpawn,
  extractConversation,
  listRuns,
  queueHook,
  renderPreparedKnowledge,
  runWorker,
  validateCandidateSet,
} from "./totonoe-codex-inbox.mjs";

function tempRoot(t) {
  const root = mkdtempSync(path.join(tmpdir(), "totonoe-codex-inbox-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function transcript(messages) {
  return messages
    .map(({ role, text }) =>
      JSON.stringify({
        type: "event_msg",
        payload: {
          type: role === "user" ? "user_message" : "agent_message",
          message: text,
          ...(role === "assistant" ? { phase: "final_answer" } : {}),
        },
      }),
    )
    .join("\n");
}

function candidate(overrides = {}) {
  return {
    title: "SessionEndフックはジョブだけを作成する",
    summary: "3秒制約を守るため蒸留処理はバックグラウンドワーカーへ分離する",
    type: "decision",
    keywords: ["Codex", "SessionEnd", "hook"],
    conclusion: "SessionEndではジョブを作成し、重い処理を別ワーカーへ渡す。",
    background: "CodexのSessionEndフックには最大3秒の制約がある。",
    verified: ["SessionEndのtimeout上限は3秒"],
    procedure: "フック入力のtranscript pathをジョブへ保存し、Nodeワーカーをdetachedで起動する。",
    cautions: ["正本への登録は自動化しない"],
    unresolved: ["なし"],
    ...overrides,
  };
}

function useTestPaths(t, root) {
  const previousStateDir = process.env.TOTONOE_INBOX_STATE_DIR;
  const previousInboxDir = process.env.TOTONOE_INBOX_DIR;
  process.env.TOTONOE_INBOX_STATE_DIR = path.join(root, "state");
  process.env.TOTONOE_INBOX_DIR = path.join(root, "inbox");
  t.after(() => {
    if (previousStateDir === undefined) delete process.env.TOTONOE_INBOX_STATE_DIR;
    else process.env.TOTONOE_INBOX_STATE_DIR = previousStateDir;
    if (previousInboxDir === undefined) delete process.env.TOTONOE_INBOX_DIR;
    else process.env.TOTONOE_INBOX_DIR = previousInboxDir;
  });
}

test("Codex event_msgからuser/assistant本文だけを抽出する", () => {
  const text = transcript([
    {
      role: "user",
      text: '<environment_context>secret setup</environment_context>\n受信箱を作りたい',
    },
    { role: "assistant", text: "SessionEndとワーカーへ分ける。" },
  ]);
  assert.equal(
    extractConversation(text),
    "ユーザー:\n受信箱を作りたい\n\nアシスタント:\nSessionEndとワーカーへ分ける。",
  );
});

test("response_item形式もfallbackとして抽出する", () => {
  const text = [
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "調査結果を残す" }],
      },
    }),
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "原因は設定漏れだった。" }],
      },
    }),
  ].join("\n");
  assert.match(extractConversation(text), /原因は設定漏れだった/);
});

test("event_msgを優先しresponse_itemのtool出力は対象にしない", () => {
  const text = [
    JSON.stringify({
      type: "event_msg",
      payload: { type: "user_message", message: "実際の依頼" },
    }),
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "response側の複製" }],
      },
    }),
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "function_call_output",
        output: "秘密を含むtool出力",
      },
    }),
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "fallback回答" }],
      },
    }),
  ].join("\n");
  const conversation = extractConversation(text);
  assert.match(conversation, /実際の依頼/);
  assert.match(conversation, /fallback回答/);
  assert.doesNotMatch(conversation, /response側の複製/);
  assert.doesNotMatch(conversation, /tool出力/);
});

test("内部のapproval review transcriptを除外する", () => {
  const text = [
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              "The following is the Codex agent history added since your last approval assessment. " +
              "Continue the same review conversation.\n>>> APPROVAL REQUEST END",
          },
        ],
      },
    }),
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "実際のユーザー依頼" }],
      },
    }),
  ].join("\n");
  assert.equal(extractConversation(text), "ユーザー:\n実際のユーザー依頼");
});

test("Windowsのcmd wrapperはcmd.exe経由で起動する", () => {
  const invocation = commandForSpawn("npx.cmd", ["--yes", "@openai/codex", "exec"], "win32");
  assert.match(invocation.command.toLowerCase(), /cmd(?:\.exe)?$/);
  assert.deepEqual(invocation.args, ["/d", "/s", "/c", "npx.cmd", "--yes", "@openai/codex", "exec"]);
});

test("SessionEnd処理はモデルを呼ばずジョブを作成する", (t) => {
  const root = tempRoot(t);
  useTestPaths(t, root);
  const transcriptPath = path.join(root, "session.jsonl");
  writeFileSync(transcriptPath, transcript([{ role: "user", text: "x".repeat(2000) }]));
  let launched;
  const started = performance.now();
  const queued = queueHook(
    { cwd: root, session_id: "session-1", transcript_path: transcriptPath },
    {
      startWorker(jobPath) {
        launched = jobPath;
      },
    },
  );
  const elapsed = performance.now() - started;
  assert.equal(queued.duplicate, false);
  assert.equal(launched, queued.jobPath);
  assert.ok(elapsed < 3000);
});

test("モックしたCodex候補をprepared_knowledge受信箱へ書く", (t) => {
  const root = tempRoot(t);
  useTestPaths(t, root);
  const transcriptPath = path.join(root, "session.jsonl");
  writeFileSync(
    transcriptPath,
    transcript([
      { role: "user", text: `受信箱を自動化したい。${"x".repeat(1800)}` },
      { role: "assistant", text: "SessionEndとworkerに分けた。" },
    ]),
  );
  const queued = queueHook(
    { cwd: root, session_id: "session-2", transcript_path: transcriptPath },
    { startWorker: () => undefined },
  );
  const result = runWorker(queued.jobPath, {
    generate: () => ({
      decision: "write",
      reason: "再利用できる設計判断がある",
      candidates: [candidate()],
    }),
    now: () => new Date("2026-07-25T01:02:03.000Z"),
  });
  assert.equal(result.status, "written");
  assert.equal(result.candidateCount, 1);
  const markdown = readFileSync(result.outputFiles[0], "utf8");
  assert.match(markdown, /^prepared_knowledge: "1"$/m);
  assert.match(markdown, /^# 未解決事項$/m);
  assert.deepEqual(listRuns(root).map(({ status }) => status), ["written"]);
});

test("SKIPは受信箱へファイルを書かない", (t) => {
  const root = tempRoot(t);
  useTestPaths(t, root);
  const transcriptPath = path.join(root, "session.jsonl");
  writeFileSync(transcriptPath, transcript([{ role: "user", text: "x".repeat(2000) }]));
  const queued = queueHook(
    { cwd: root, session_id: "session-3", transcript_path: transcriptPath },
    { startWorker: () => undefined },
  );
  const result = runWorker(queued.jobPath, {
    generate: () => ({ decision: "skip", reason: "雑談のみ", candidates: [] }),
  });
  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "雑談のみ");
});

test("候補の形式とprepared_knowledge描画を検証する", () => {
  const set = { decision: "write", reason: "test", candidates: [candidate()] };
  assert.deepEqual(validateCandidateSet(set), []);
  const markdown = renderPreparedKnowledge(candidate({ conclusion: "# 危険な見出し\n本文" }));
  assert.match(markdown, /^## 危険な見出し$/m);
  assert.doesNotMatch(markdown, /^# 危険な見出し$/m);
  assert.match(markdown, /^  - "Codex"$/m);
});
