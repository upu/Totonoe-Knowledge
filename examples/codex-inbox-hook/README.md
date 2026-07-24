# Codex 受信箱フック

[エージェント連携の受信箱パターン](../../docs/AGENT_INTEGRATION.md)を、Codexの`SessionEnd`フックと`codex exec`で動かす実装です。

```text
Codexのメインセッション終了
  → SessionEndフックがtranscript pathをジョブへ保存（3秒以内）
  → detached workerがuser/assistant本文だけを抽出
  → codex execが再利用価値を判定し、最大3件の候補を構造化出力
  → workerがprepared_knowledge Markdownをinbox/へ保存
  → 人が内容を精査し、確認付き登録フローで正本化
```

正本への登録は自動化しません。受信箱の候補は未承認であり、検索索引にも含めません。

## 必要なもの

- Node.js 20以上
- 同じユーザーで認証済みのCodex CLI
- 信頼済みのCodexプロジェクト

ターミナルから`codex --version`と`codex exec --ephemeral "OKと答えて"`が動くことを先に確認してください。Codexデスクトップアプリ、IDE拡張、CLIは同じローカル設定と認証を共有しますが、`codex`実行ファイルがPATHにない場合は別途CLIを導入するか、後述の`TOTONOE_INBOX_CODEX_CMD`で実行ファイルを指定します。

## セットアップ

このリポジトリでは[`.codex/hooks.json`](../../.codex/hooks.json)を追加済みです。

1. このリポジトリを信頼済みプロジェクトとしてCodexで開く
2. 新しいセッションを開始する
3. CLIでは`/hooks`を開き、表示されたプロジェクトフックの内容を確認してtrustする
4. 再利用できる結論を含む会話を終える
5. 数分後に`inbox/`を確認する

新規・変更済みの非管理フックは、Codexで内容をreviewしてtrustするまで実行されません。スクリプトを変更するとhashが変わるため、再度reviewが必要です。

別のプロジェクトで利用する場合は、このディレクトリをコピーし、`.codex/hooks.json`のコマンドをコピー先へ合わせてください。`inbox/`と`.totonoe/codex-inbox/`は必ず`.gitignore`へ追加します。

## 設定

フックはCodexプロセスの環境変数を引き継ぎます。デスクトップアプリで使う場合は、環境変数を設定してからアプリを再起動してください。

| 変数 | 既定値 | 説明 |
|---|---|---|
| `TOTONOE_INBOX_DIR` | `<session cwd>/inbox` | 未承認候補の保存先 |
| `TOTONOE_INBOX_STATE_DIR` | `<session cwd>/.totonoe/codex-inbox` | ジョブ、実行状態、診断出力 |
| `TOTONOE_INBOX_MIN_CHARS` | `1500` | これより短い会話はモデルを呼ばずにSKIP |
| `TOTONOE_INBOX_MAX_CHARS` | `80000` | Codexへ渡す会話の最大文字数 |
| `TOTONOE_INBOX_CODEX_CMD` | `codex` | `codex`実行ファイル。値全体を1つの実行ファイルpathとして扱う |
| `TOTONOE_INBOX_CODEX_PREFIX_ARGS` | `[]` | wrapper実行時に`exec`より前へ付ける文字列のJSON配列 |
| `TOTONOE_INBOX_MODEL` | Codexの既定モデル | 候補抽出だけ別モデルにする場合のmodel slug |
| `TOTONOE_INBOX_REASONING_EFFORT` | `low` | 候補抽出のreasoning effort |
| `TOTONOE_INBOX_CODEX_TIMEOUT_MS` | `180000` | backgroundの`codex exec`タイムアウト |

Windowsのデスクトップアプリ同梱`codex.exe`を外部プロセスから起動できない場合は、公式npm版CLIをPATHへインストールする方法を推奨します。一時的に`npx`を使って検証する場合は、Codexを起動する前に次を設定できます。`npx`は必要に応じてパッケージを取得するため、常用時はversionを固定してください。

```powershell
$env:TOTONOE_INBOX_CODEX_CMD = "npx.cmd"
$env:TOTONOE_INBOX_CODEX_PREFIX_ARGS = '["--yes","@openai/codex@0.145.0"]'
```

子`codex exec`は次の制約で起動します。

- `--ephemeral`: 子セッションのrolloutを保存しない
- `--sandbox read-only`: リポジトリを変更させない
- `--ask-for-approval never`: backgroundで承認待ちにしない
- `--disable hooks`: 子セッションから同じフックを再帰発火させない
- `--ignore-user-config`と`--ignore-rules`: 候補抽出に不要なMCP、plugin、repo指示を読み込まない
- `model_reasoning_effort="low"`: 蒸留用途で過剰なreasoning利用を避ける
- `--output-schema`: 候補をJSON Schemaで制約し、スクリプト側でMarkdown化する

## 状態確認と手動再現

直近の結果を確認します。

```powershell
node examples/codex-inbox-hook/totonoe-codex-inbox.mjs --status
```

`failed`の場合は、同じ行のerrorと`.totonoe/codex-inbox/outputs/`に残った診断出力を確認します。特定のCodex transcriptをforegroundで再処理するには次を実行します。

```powershell
node examples/codex-inbox-hook/totonoe-codex-inbox.mjs --process "C:\path\to\rollout.jsonl"
```

`--process`は実際に`codex exec`を呼び、候補を`inbox/`へ書きます。

## セキュリティとコスト

- transcriptは候補抽出のため`codex exec`へもう一度送信されます。元のCodexセッションと同じ認証・provider設定を使います
- transcriptは未信頼データとしてプロンプトへ渡し、会話内の命令には従わないよう指示します
- tool output、reasoning、system/developer messageは抽出せず、user/assistant本文だけを対象にします
- transcript形式はCodexの安定APIではないため、防御的に複数形式を読み、解析不能時はfail closedで診断を残します
- 受信箱は未承認かつ秘密情報候補検査前です。commit・共有・検索索引へ含めないでください
- 正本化は[AIなしの構造化済みナレッジ登録](../../docs/PREPARED_KNOWLEDGE.md)で行い、秘密情報候補検査、差分確認、明示的な登録操作を省略しません
- 有用なセッションごとに追加のCodex利用量が発生します。`TOTONOE_INBOX_MIN_CHARS`や`TOTONOE_INBOX_MODEL`で調整できます

## 現在の制約

- `SessionEnd`はメインスレッド終了時だけ発火し、subagent終了時には発火しません
- hookの`transcript_path`は便利な参照ですが、Codexが安定性を保証する形式ではありません
- 非同期command hookはまだサポートされていないため、Nodeのdetached workerを明示的に起動しています
- Codex CLIを別プロセスとして起動できない環境では候補抽出できません。その場合も元のセッション終了は妨げず、`--status`へ失敗理由を残します
