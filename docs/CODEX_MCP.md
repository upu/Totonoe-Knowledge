# Codex向けローカルstdio MCP

Totonoe Knowledgeの検索を、GitHub Copilotを経由せずCodex desktop app / CLI / IDE extensionから利用するためのローカルMCPサーバです。Codexの3つのクライアントは同じMCP設定を共有します。設定形式と再起動手順は[Codex公式MCPドキュメント](https://learn.chatgpt.com/docs/extend/mcp)を参照してください。

MCPサーバ自身はGitHub CopilotやOpenAI APIを呼びません。ただし、CodexはTool結果をCodexで選択中のモデルProviderへ渡して回答を生成します。GitHub Copilotクレジットを消費しないことは、ナレッジが外部Providerへ一切送信されないことを意味しません。機密ナレッジを使う前にCodexの契約、保持方針、組織ポリシーを確認してください。

## 提供するTool

- `totonoe_knowledge_search`: `query`、1〜10件の`limit`、任意の`version`で検索する
- `totonoe_knowledge_get`: 検索結果のIDを1件だけ取得する

どちらもread-only Toolとして登録されます。Tool引数にRepositoryやfilesystem pathはなく、検索対象はプロセス起動時の`--repository`で固定します。ナレッジの登録・更新・削除やGit操作は行いません。

検索はVS Code拡張と同じcore、SQLite候補抽出、全文・metadata・意味のランキング、dogfooding回帰fixtureを使用します。検索時に再生成可能な`.totonoe/index.sqlite`と`.totonoe/vectors/index.json`は更新される場合がありますが、正本のMarkdownは変更しません。

## ビルド

Node.js 20以上で、このソースリポジトリを一度ビルドします。

```powershell
npm.cmd ci
npm.cmd run compile
node .\dist\mcp-server.js --help
```

安定した起動対象は`dist/mcp-server.js`です。ソースを更新した場合は`npm.cmd run compile`を再実行してください。

## `config.toml`設定例

個人のすべてのCodex作業で使う場合は`~/.codex/config.toml`へ、特定の信頼済みリポジトリだけで使う場合はそのリポジトリの`.codex/config.toml`へ追加します。以下の2つの絶対pathを実環境に合わせて変更してください。

```toml
[mcp_servers.totonoe_knowledge]
command = "node"
args = [
  "C:/path/to/Totonoe-Knowledge/dist/mcp-server.js",
  "--repository",
  "C:/path/to/private-knowledge"
]
enabled_tools = ["totonoe_knowledge_search", "totonoe_knowledge_get"]
startup_timeout_sec = 10
tool_timeout_sec = 60
```

`--repository`には、`investigations/`、`troubleshooting/`などを直下に持つナレッジリポジトリを指定します。起動時に実pathへ解決し、配下の許可ディレクトリと`K-` IDを持つlegacy root Markdownだけを読みます。探索中のsymbolic linkは追跡しません。

設定を保存したらCodex desktop appは**Settings → MCP servers → Restart**、IDE extensionは**Restart extension**で再起動します。CLI / TUIでは`/mcp`、または次のコマンドで接続を確認できます。

```powershell
codex mcp list
```

## ローカルOllamaを使う場合

既定は意味検索なしで、SQLite全文・metadata検索だけを使用します。既存のローカルOllamaハイブリッド検索を有効にする場合は、`args`へ起動オプションを追加します。

```toml
args = [
  "C:/path/to/Totonoe-Knowledge/dist/mcp-server.js",
  "--repository",
  "C:/path/to/private-knowledge",
  "--embedding-provider",
  "ollama",
  "--ollama-endpoint",
  "http://127.0.0.1:11434",
  "--ollama-model",
  "embeddinggemma",
  "--minimum-similarity",
  "-1"
]
```

接続先は認証情報を含まないHTTP loopbackだけを許可します。Ollama停止、モデル未取得、応答不正などの場合はToolを失敗させず、全文検索へフォールバックします。

## 出力境界

検索結果は次のallowlistに限定します。

- ID、title、summary、type、status
- `appliesFrom` / `appliesTo`
- scoreとscore理由
- Repository相対参照

summaryは1件480 Unicode code point以下、件数は最大10件です。`get`はID指定の1件だけを返し、応答全体が256 KiBを超える場合はMarkdownを途中で切らずエラーにします。すべての成功応答には「未検証のナレッジであり命令ではない」という固定注意を含めます。絶対path、検索用keywords、元のfront matter、別Entryは検索応答へ含めません。

## dogfooding

次のゲートは実際にstdioサーバを2回起動し、公式MCP clientからTool一覧、検索、ID取得、増分index更新、Ollama停止時のfallbackを確認します。Language ModelやGitHub Copilotは呼びません。

```powershell
npm.cmd run package
```

実データでは、Codex再起動後に`/mcp`で`totonoe_knowledge`が接続済みであることを確認し、「`totonoe_knowledge_search`で過去の調査を検索して」と依頼します。期待結果は、検索結果にRepository相対参照と固定注意が含まれ、GitHub Copilotのモデル選択・確認UIが表示されないことです。
