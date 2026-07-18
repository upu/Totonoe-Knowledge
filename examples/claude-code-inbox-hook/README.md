# Claude Code 受信箱フックのプロトタイプ

[docs/AGENT_INTEGRATION.md](../../docs/AGENT_INTEGRATION.md) の受信箱パターンを、Claude CodeのSessionEndフックで実装したプロトタイプです。VS Code拡張側の変更なしで動作します。

セッション終了時にやり取りを`claude -p`で要約し、[prepared_knowledge形式](../../docs/PREPARED_KNOWLEDGE.md)の下書きを受信箱フォルダーへ書き出します。正本への登録は自動化しません。人が下書きをreviewし、拡張機能の`AIを使わず選択範囲から登録`で保存します。

```text
Claude Codeセッション終了（SessionEndフック）
  → transcriptからユーザー・アシスタントの発言を抽出
  → claude -p でprepared_knowledge形式へ蒸留（登録価値がなければSKIP）
  → 形式を検証し inbox/ へ下書きを保存
  → 人がreviewし「AIを使わず登録」で正本化（この経路は外部通信なし）
```

## セットアップ

Node.js 20以上とClaude Code CLIが必要です。ナレッジを扱うプロジェクトの `.claude/settings.json`（チーム共有）または `.claude/settings.local.json`（個人）へ追加します。

```json
{
  "hooks": {
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"%CLAUDE_PROJECT_DIR%/examples/claude-code-inbox-hook/totonoe-inbox-hook.mjs\"",
            "timeout": 180
          }
        ]
      }
    ]
  }
}
```

macOS / Linuxでは `"$CLAUDE_PROJECT_DIR/..."` を使用します。

## 環境変数

| 変数 | 既定値 | 説明 |
|---|---|---|
| `TOTONOE_INBOX_DIR` | `<セッションのcwd>/inbox` | 下書きの保存先 |
| `TOTONOE_INBOX_MODEL` | `sonnet` | 蒸留に使うモデル |
| `TOTONOE_INBOX_MIN_CHARS` | `1500` | これより短いやり取りは蒸留しない |
| `TOTONOE_INBOX_CLAUDE_CMD` | `claude` | CLIコマンドの差し替え（テスト用） |

## 動作の詳細

- 蒸留はモデルが判断し、登録価値がないセッションでは何も書き出しません
- 出力は保存前に形式検証します。front matter、type、6つの固定見出しが揃わない場合は`.rejected.md`として保存し、内容は失われません
- `claude -p`の子セッション終了で同じフックが再発火しないよう、環境変数`TOTONOE_INBOX_HOOK_ACTIVE`で再帰を防止します
- フックは常にexit 0で終了し、セッション終了を妨げません

## セキュリティと運用上の注意

- 蒸留はtranscriptの内容を`claude -p`経由でAnthropicへ送信します。送信先は元のClaude Codeセッションと同じですが、ナレッジ運用として送信先を把握しておいてください
- 受信箱の下書きは未承認かつ秘密情報検査前の内容です。このリポジトリでは`inbox/`を`.gitignore`済みですが、別プロジェクトで使う場合も受信箱をcommit対象・検索索引対象へ含めないでください
- 登録時の人による確認と秘密情報候補検査は、拡張機能の登録フロー側で必ず実施されます
- セッション終了のたびに`claude -p`が1回実行されます。コストを抑えたい場合は`TOTONOE_INBOX_MODEL=haiku`を設定してください

## 制約（プロトタイプ）

- 1セッションから作る下書きは最大1件です。複数の結論を含むセッションの分割は今後の課題です
- 長いtranscriptは先頭1万字と末尾7万字へ切り詰めます
- `applies_from`や`related`などの関係metadataは下書きに含めず、登録時のプレビューで人が設定します
