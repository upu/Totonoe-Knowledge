# Totonoe Knowledge

調査・判断・試行錯誤の結果を、後から検索・再利用・統合できるMarkdownナレッジへ整えるVS Code拡張です。

> Status: v0.1 Local MVP complete / v0.2 Copilot Tool Integration next

## なぜ作るのか

長期間の開発では、仕様書、変更資料、チャット、Issue、ソースコードに知識が分散し、「現在の仕様」が追いにくくなります。Totonoe Knowledgeは、調べた内容を根拠と適用範囲を持つ小さなナレッジとして蓄積し、将来の検索・知識継承・現行仕様の再構築につなげます。

設計の基本方針は次のとおりです。

- Markdownを正本とし、DBは再生成可能な検索インデックスにする
- AI生成結果は保存前に人が確認する
- 変更履歴を上書きせず、`supersedes` と適用範囲で関係を表す
- 機能のソースコードと、利用者が扱う機密ナレッジを分離する
- AIなしでも登録・検索できる状態を維持する

Entryの分割・統合やtype選択は [Knowledge Entryの粒度ガイドライン](docs/KNOWLEDGE_GRANULARITY.md) を参照してください。粒ナレッジと累積版（Current View）の整理・矛盾検出の設計は [docs/KNOWLEDGE_CURATION.md](docs/KNOWLEDGE_CURATION.md)、自動検索・受信箱によるエージェント連携の設計は [docs/AGENT_INTEGRATION.md](docs/AGENT_INTEGRATION.md) を参照してください。

## インストール後の初期設定

DBを手動で作成する必要はありません。インストールしただけではファイルを作成せず、必要になった時点で次のように自動作成します。

- 初回登録時: 既定では、開いているワークスペース内に `knowledge/<種別>/` を作成してMarkdownを保存
- 初回の通常検索時: ワークスペース直下の `.totonoe/index.sqlite` を自動作成し、以後の検索前にMarkdownの変更を反映

利用開始時は、保存先にする信頼済みワークスペースをVS Codeで開くだけです。既定の保存先 `knowledge` を使う場合、設定変更は必要ありません。そのまま `Totonoe Knowledge: Register from Clipboard`、`Register Selection`、または `Search` を実行できます。

別の場所にある既存のナレッジ専用フォルダーを使う場合だけ、`Totonoe Knowledge: Select Knowledge Repository Folder` で選択してください。この場合は、選択したフォルダー直下に種別ディレクトリと `.totonoe/index.sqlite` が必要に応じて作られます。

SQLiteはMarkdownを高速に検索するための再生成可能な派生データです。事前準備やバックアップは不要で、削除・破損した場合も次回検索または `Totonoe Knowledge: Rebuild Search Index` でMarkdownから作り直せます。意味検索用のOllamaも任意で、初期状態では無効です。

## 機能

コマンドパレットから次のコマンドを実行できます。

- `Totonoe Knowledge: Register from Clipboard`
- `Totonoe Knowledge: Register Selection`
- `Totonoe Knowledge: AIでクリップボード／選択範囲から登録`
- `Totonoe Knowledge: AIを使わずクリップボード／選択範囲から登録`
- `Totonoe Knowledge: Select Knowledge Repository Folder`
- `Totonoe Knowledge: Show Knowledge Repository`
- `Totonoe Knowledge: Use Workspace Repository`
- `Totonoe Knowledge: Search`
- `Totonoe Knowledge: Search for Version`
- `Totonoe Knowledge: Validate Repository`
- `Totonoe Knowledge: Rebuild Search Index`

先頭の2コマンドでは登録時に生成方法を選択します。AIを使うかどうか決めている場合は、それぞれの直接コマンドも使用できます。

- `AIでナレッジ案を作る`: VS Codeで利用可能なAIモデルを選び、タイトル、要約、種別、キーワード、本文を生成
- `AIを使わずナレッジ案を作る`: 構造化済みMarkdownをローカルで読み込む。通常テキストでは入力用のひな形を生成

AI生成時は分類を含む生成結果をMarkdownプレビューで直接確認・編集します。AIなしでは、`prepared_knowledge: "1"`形式ならtitle、summary、type、keywordsと固定本文セクションを再入力させずプレビューへ反映し、通常テキストなら従来の入力用ひな形を作ります。詳細は [docs/PREPARED_KNOWLEDGE.md](docs/PREPARED_KNOWLEDGE.md) を参照してください。AIの構造化出力は実行時に検証され、失敗した場合はAIを使わない登録へ安全に切り替えられます。

ローカルワークスペースでは、種別、ID、タイトルから `knowledge/<種別>/<ID>-<タイトル>.md` を先に決め、その保存先に関連付けたプレビューを開きます。内容を確認・編集後、通知またはeditor titleの `この内容を登録` から明示的に保存できます。`Untitled-1.md`の保存先を手動で選ぶ必要はなく、通常どおり `Ctrl+S` で保存する方法も残しています。

検索前にMarkdownの変更を `.totonoe/index.sqlite` へ増分反映し、SQLite FTSで最大200件の候補へ絞り込みます。空白なしの長い日本語検索文は2・3文字の部分列へ展開し、助詞・補助表現由来の低情報部分列を除いた一致根拠で候補Markdownを再評価します。最終順位はタイトル、要約、キーワード、本文を異なる重みで評価し、日本語・英数字・エラーコード・部分一致・複数語を含む検索結果をQuick Pickへ表示します。インデックスがない、壊れている、または利用できない場合もMarkdownから再構築または直接検索でき、正本の情報は失われません。

意味検索は既定で無効です。設定でローカルOllamaを明示的に選ぶと、SQLite全文候補とベクトル類似候補を結合し、全文・メタデータ・意味のscoreで順位付けします。通信先はHTTP loopbackだけに制限し、Ollamaを利用できない場合は従来の全文検索へ安全に戻ります。モデルはVSIXへ同梱せず、ベクトルは `.totonoe/vectors/index.json` へ再生成可能な派生データとして保存します。

整合性検査は必須メタデータ、type、日時、固定見出し、重複ID、存在しない `related` / `supersedes`、自己参照を検査し、VS CodeのProblemsへ表示します。

`Search for Version`では`applies_from` / `applies_to`で適用範囲を絞り、そのバージョンで有効なEntryの`supersedes`を推移的に評価して、置き換え済みEntryを結果から除外します。詳細は [docs/VERSION_APPLICABILITY.md](docs/VERSION_APPLICABILITY.md) を参照してください。

Agentモードからは、次のLanguage Model Toolを明示的に参照できます。

- `#totonoeKnowledgeSave`: 会話で整理した内容を、確認付きでMarkdownへ保存
- `#totonoeKnowledgeSearch`: 過去の仕様、調査、手順、既知問題を検索

Save Toolはファイル作成前にVS Codeの確認を要求します。Search Toolが返すMarkdownナレッジは未検証の資料として扱い、状態・適用範囲・根拠を確認するようモデルへ通知します。

## セキュリティ境界

このGitHubリポジトリは機能のソースコードを公開する場所です。実際の社外秘ナレッジは、この公開リポジトリへ保存しないでください。社内Git、privateリポジトリ、またはアクセス制御されたローカルワークスペースを別に用意してください。

AIを使わない登録は外部通信を行いません。AI生成を選ぶと、登録元テキストがユーザーの選択したVS Code Language Model Providerへ送信されます。外部送信前と、生成した保存先付きプレビューを開く前に秘密情報らしい文字列を検査して警告しますが、検出には誤りや見逃しがあります。

詳細は [SECURITY.md](SECURITY.md) を参照してください。

ナレッジの読み書きとAgent Toolを提供するため、VS Codeで信頼済みのワークスペースだけをサポートします。

## 開発環境

前提:

- Node.js 20以上
- npm
- VS Code 1.95以上

```bash
npm install
npm run package
```

`npm run package` は型チェック、30件以上のユニットテスト、Extension Host向けバンドルを実行します。`npm run test:integration` はVS Code Stableを起動し、activate・コマンド・Tool・Problems診断・SQLiteインデックス再構築を確認します。VS Codeテスト環境の取得だけは一時的な通信失敗に備えて最大3回再試行し、起動後のテスト失敗は再試行しません。Pull Requestと`main`へのpushでも両方をGitHub Actionsで実行します。

VS Codeでこのフォルダーを開き、`F5`を押すとExtension Development Hostで実行できます。

### ActionsのVSIXを試す

Marketplace公開前のdogfoodingでは、GitHub Actionsの成功したrunから `totonoe-knowledge-vsix-<commit SHA>` artifactを取得できます。zipを展開し、VS CodeのExtensionsビューにある `Install from VSIX...` からインストールしてください。

artifactは14日間保存されるpre-alphaビルドです。機密ナレッジを扱う前に、対象commitと [SECURITY.md](SECURITY.md) を確認してください。MarketplaceやGitHub Releaseへの自動公開は行いません。

## 設定

| 設定 | 既定値 | 説明 |
|---|---:|---|
| `totonoeKnowledge.repositoryPath` | `knowledge` | 外部フォルダーを選択していない場合のワークスペース内保存先 |
| `totonoeKnowledge.generator` | `ask` | `ask` / `template` / `languageModel` |
| `totonoeKnowledge.secretScanning.enabled` | `true` | 外部送信前と登録プレビュー作成時の秘密情報候補検査 |
| `totonoeKnowledge.embedding.provider` | `disabled` | `disabled` / ローカルの `ollama` |
| `totonoeKnowledge.embedding.ollama.endpoint` | `http://127.0.0.1:11434` | HTTP loopbackのみ |
| `totonoeKnowledge.embedding.ollama.model` | `embeddinggemma` | Ollamaで取得済みのモデル名 |
| `totonoeKnowledge.embedding.minimumSimilarity` | `0.45` | 意味候補として採用する類似度下限 |

既定では先頭ワークスペースと `repositoryPath`を使用します。別cloneしたナレッジ専用リポジトリは `Select Knowledge Repository Folder` で明示的に選択できます。選択中の場所は `Show Knowledge Repository` で確認でき、`Use Workspace Repository`で従来のワークスペース相対パスへ戻せます。詳細は [docs/REPOSITORY_SELECTION.md](docs/REPOSITORY_SELECTION.md) を参照してください。

検索インデックスはワークスペース利用時はワークスペース、外部リポジトリ利用時は選択したフォルダーの `.totonoe/` に作られ、Git管理対象外です。Markdown変更は次の検索時にファイルの更新時刻とサイズで判定し、追加・変更・削除分だけ反映します。SQLiteは `Rebuild Search Index` から、ベクトルはキャッシュ削除後の次回検索で全Markdownから作り直せます。詳細は [docs/SEARCH_INDEX.md](docs/SEARCH_INDEX.md) を参照してください。

## 保存形式

```text
knowledge/
├─ investigations/
├─ troubleshooting/
├─ specifications/
├─ changes/
├─ procedures/
└─ decisions/
```

Markdownのfront matterにはID、タイトル、要約、種別、状態、キーワード、日時、関連・置き換え関係を保持します。元情報は引用として残し、生成内容の根拠まで戻れるようにします。

適用開始・終了バージョンは包含境界の`applies_from` / `applies_to`として保持します。AIには推測させず、人が根拠を確認して設定します。

## v0.3の状態

実装済み:

- 拡張機能の初期構成
- クリップボード／選択範囲からの登録
- AIなしテンプレートと交換可能なGenerator境界
- VS Code Language Modelによる構造化生成
- 外部送信前／登録プレビュー作成時の秘密情報候補警告
- 重み付きMarkdown全文検索
- ユニットテストとGitHub Actions
- Agent向けSave/Search Language Model Tool
- ナレッジ整合性検査とProblems連携
- 実Extension Host統合テスト
- Markdownから再構築可能なSQLite FTS検索インデックス
- フォルダー選択によるワークスペース外ナレッジリポジトリ
- 12件の実データdogfoodingと検索回帰テスト
- 明示選択式のローカルOllama Embedding Provider
- 全文・意味・メタデータのハイブリッドランキングとscore理由表示
- Markdown原文を保存しない増分ベクトル索引と全文検索フォールバック

v0.1のdogfoodingとv0.2のAgent Tool確認は完了しています。v0.3のローカルOllamaを使う手動確認項目は [docs/MANUAL_TEST.md](docs/MANUAL_TEST.md) にあります。

コマンドとLanguage Model Toolの手動確認項目は [docs/MANUAL_TEST.md](docs/MANUAL_TEST.md) にあります。

全体計画は [docs/ROADMAP.md](docs/ROADMAP.md) を参照してください。

個人用／チーム用Repositoryの分離、`git pull`後のindex更新、Pull Request review、classificationと権限の運用は [docs/GIT_TEAM_WORKFLOW.md](docs/GIT_TEAM_WORKFLOW.md) を参照してください。新しいKnowledge Repositoryには [team repository template](templates/knowledge-repository/README.md) を利用できます。

将来のHTTP Repository / MCPサーバはまだ未実装です。社外秘データを扱う前提の認証・認可・Tool出力・監査境界は [docs/REMOTE_SECURITY_MODEL.md](docs/REMOTE_SECURITY_MODEL.md)、API契約は [docs/REMOTE_REPOSITORY_API.md](docs/REMOTE_REPOSITORY_API.md)、可読バックアップと復旧手順は [docs/BACKUP_RESTORE.md](docs/BACKUP_RESTORE.md) に先行して定義しています。

## コントリビューション

[CONTRIBUTING.md](CONTRIBUTING.md) と対象Issueの受け入れ条件を確認してください。外部通信や機密情報の境界を変えるPull Requestでは、その影響を明記してください。

## ライセンス

[MIT License](LICENSE)
