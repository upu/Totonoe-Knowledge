#!/usr/bin/env node
// Claude Code SessionEnd hook: セッションのやり取りをprepared_knowledge形式へ蒸留し、
// 受信箱フォルダーへ下書きとして書き出す。正本への登録は人がVS Code拡張の
// 「AIを使わず登録」フローで行う。設計は docs/AGENT_INTEGRATION.md を参照。
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const KNOWLEDGE_TYPES = [
  "investigation",
  "troubleshooting",
  "specification",
  "change",
  "procedure",
  "decision",
];
const FIXED_HEADINGS = ["結論", "背景", "確認したこと", "対応方法", "注意点", "未解決事項"];
const MAX_PROMPT_CHARS = 80000;
const HEAD_KEEP_CHARS = 10000;

function log(message) {
  process.stderr.write(`[totonoe-inbox] ${message}\n`);
}

function extractConversation(transcriptPath) {
  const lines = readFileSync(transcriptPath, "utf8").split("\n");
  const parts = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== "user" && entry.type !== "assistant") continue;
    const content = entry.message?.content;
    let text = "";
    if (typeof content === "string") {
      text = content;
    } else if (Array.isArray(content)) {
      text = content
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join("\n");
    }
    text = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
    if (!text) continue;
    parts.push(`${entry.type === "user" ? "ユーザー" : "アシスタント"}:\n${text}`);
  }
  return parts.join("\n\n");
}

function clip(conversation) {
  if (conversation.length <= MAX_PROMPT_CHARS) return conversation;
  const tailKeep = MAX_PROMPT_CHARS - HEAD_KEEP_CHARS;
  return (
    conversation.slice(0, HEAD_KEEP_CHARS) +
    "\n\n...（中略）...\n\n" +
    conversation.slice(conversation.length - tailKeep)
  );
}

function buildPrompt(conversation) {
  return `あなたは開発セッションの記録係です。以下のAIコーディングセッションのやり取りを読み、後日検索・再利用する価値のある知識（調査で判明した事実、決定と理由、仕様、変更内容、再現可能な手順、トラブルの原因と解消方法）が含まれるか判断してください。

再利用できる結論が1つも含まれない場合（作業指示と実行だけで新しい発見がない、雑談のみ、途中で放棄された作業のみ）に限り、他の文字を一切含めず「SKIP」とだけ出力してください。ユーザーが「覚えておきたい」「記録したい」「ナレッジにしたい」などの意図を示している場合は必ず文書を出力します。判断に迷う場合も文書を出力してください。下書きは人がreviewして破棄できますが、出力されなかった知識は失われます。

価値がある場合は、最も重要な結論1つをprepared_knowledge形式のMarkdown文書1つとして出力してください。コードフェンスで囲まず、文書だけを出力します。

形式の要件:
- 先頭にYAML front matter: prepared_knowledge: "1"、title、summary、type、keywords
- typeは ${KNOWLEDGE_TYPES.join(" / ")} のいずれか
- titleは対象と結論を識別できる具体的な表現
- summaryは結論を1文で。背景や作業経過を入れない
- keywordsは別名、製品名、error code、file名など検索に使う表現を3〜7件のYAMLリストで
- 本文は次の6見出しを必ずこの順で持つ: ${FIXED_HEADINGS.map((h) => `「# ${h}」`).join("、")}
- 「確認したこと」「注意点」「未解決事項」は1件以上の箇条書きを持つ（該当なしなら「- なし」）
- ID、status、日時、applies_from、applies_to、related、supersedesは書かない
- セッションで確認していないことを確定事項として書かない

出力例:
---
prepared_knowledge: "1"
title: "SQLite FTSの日本語検索は2/3-gram展開で部分一致させる"
summary: "空白なし日本語検索文はn-gram展開し低情報部分列を除外して照合する"
type: investigation
keywords:
  - "SQLite"
  - "FTS"
  - "n-gram"
---

# 結論
...

# 背景
...

# 確認したこと
- ...

# 対応方法
...

# 注意点
- ...

# 未解決事項
- なし

--- セッションのやり取りここから ---

${conversation}`;
}

function runClaude(prompt) {
  const cmdString = process.env.TOTONOE_INBOX_CLAUDE_CMD || "claude";
  const model = process.env.TOTONOE_INBOX_MODEL || "sonnet";
  if (!/^[a-zA-Z0-9._-]+$/.test(model)) {
    log(`TOTONOE_INBOX_MODELが不正なため中止: ${model}`);
    return null;
  }
  const result = spawnSync(`${cmdString} -p --model ${model}`, {
    input: prompt,
    encoding: "utf8",
    shell: true,
    timeout: 150000,
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, TOTONOE_INBOX_HOOK_ACTIVE: "1" },
  });
  if (result.error) {
    log(`claude CLIの起動に失敗: ${result.error.message}`);
    return null;
  }
  if (result.status !== 0) {
    log(`claude CLIが異常終了 (exit ${result.status}): ${(result.stderr || "").slice(0, 500)}`);
    return null;
  }
  return result.stdout;
}

function stripFence(text) {
  const match = text.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```\s*$/);
  return match ? match[1] : text;
}

function validatePrepared(doc) {
  const problems = [];
  if (!/^---\n[\s\S]+?\n---/.test(doc)) problems.push("front matterがない");
  if (!/^prepared_knowledge:\s*["']1["']\s*$/m.test(doc)) problems.push("prepared_knowledgeがない");
  if (!/^title:\s*\S.*$/m.test(doc)) problems.push("titleが空");
  if (!/^summary:\s*\S.*$/m.test(doc)) problems.push("summaryが空");
  if (!new RegExp(`^type:\\s*(${KNOWLEDGE_TYPES.join("|")})\\s*$`, "m").test(doc)) {
    problems.push("typeが不正");
  }
  if (!/^keywords:/m.test(doc)) problems.push("keywordsがない");
  for (const heading of FIXED_HEADINGS) {
    if (!new RegExp(`^#\\s*${heading}\\s*$`, "m").test(doc)) {
      problems.push(`見出し「${heading}」がない`);
    }
  }
  return problems;
}

function main() {
  if (process.env.TOTONOE_INBOX_HOOK_ACTIVE === "1") return;

  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    log("stdinのhook入力を解析できないため中止");
    return;
  }

  const transcriptPath = input.transcript_path;
  if (!transcriptPath || !existsSync(transcriptPath)) {
    log("transcriptが見つからないため中止");
    return;
  }

  const conversation = extractConversation(transcriptPath);
  const minChars = Number(process.env.TOTONOE_INBOX_MIN_CHARS || 1500);
  if (conversation.length < minChars) {
    log(`やり取りが短いため中止 (${conversation.length} < ${minChars})`);
    return;
  }

  const output = runClaude(buildPrompt(clip(conversation)));
  if (output === null) return;

  const doc = stripFence(output.trim());
  if (doc === "SKIP") {
    log("登録価値なしと判断されたため書き出しなし");
    return;
  }

  const inboxDir = process.env.TOTONOE_INBOX_DIR || path.join(input.cwd || process.cwd(), "inbox");
  mkdirSync(inboxDir, { recursive: true });

  const sessionId = String(input.session_id || "unknown").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 8);
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .slice(0, 15);
  const problems = validatePrepared(doc);
  const fileName = problems.length === 0 ? `${stamp}-${sessionId}.md` : `${stamp}-${sessionId}.rejected.md`;
  writeFileSync(path.join(inboxDir, fileName), doc.endsWith("\n") ? doc : `${doc}\n`, "utf8");

  if (problems.length > 0) {
    log(`下書きが形式検証に失敗 (${problems.join("、")})。${fileName} として保存`);
  } else {
    log(`${fileName} を受信箱へ保存`);
  }
}

main();
