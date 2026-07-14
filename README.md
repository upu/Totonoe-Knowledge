# Totonoe Knowledge

調査・判断・試行錯誤の結果を、後から検索・再利用・統合できるMarkdownナレッジへ整えるVS Code拡張です。

> Status: pre-alpha / v0.1 dogfooding前

## なぜ作るのか

長期間の開発では、仕様書、変更資料、チャット、Issue、ソースコードに知識が分散し、「現在の仕様」が追いにくくなります。Totonoe Knowledgeは、調べた内容を根拠と適用範囲を持つ小さなナレッジとして蓄積し、将来の検索・知識継承・現行仕様の再構築につなげます。

設計の基本方針は次のとおりです。

- Markdownを正本とし、DBは再生成可能な検索インデックスにする
- AI生成結果は保存前に人が確認する
- 変更履歴を上書きせず、`supersedes` と適用範囲で関係を表す
- 機能のソースコードと、利用者が扱う機密ナレッジを分離する
- AIなしでも登録・検索できる状態を維持する

## 機能

コマンドパレットから次のコマンドを実行できます。

- `Totonoe Knowledge: Register from Clipboard`
- `Totonoe Knowledge: Register Selection`
- `Totonoe Knowledge: Search`
- `Totonoe Knowledge: Validate Repository`

登録時は次の生成方法を選択できます。

- `Language Modelで整える`: VS Codeで利用可能なモデルを選び、構造化されたナレッジ案を生成
- `テンプレートで作る`: 外部送信せず、ローカルで編集可能なひな形を生成

生成後にタイトル、超要約、種別、キーワードを確認し、Markdown本文を自由に編集してから保存します。Language Modelの構造化出力は実行時に検証され、失敗した場合はテンプレートへ安全に切り替えられます。

検索はタイトル、要約、キーワード、本文を異なる重みで評価し、日本語・英数字・複数語を含む検索結果をQuick Pickへ表示します。

整合性検査は必須メタデータ、type、日時、固定見出し、重複ID、存在しない `related` / `supersedes`、自己参照を検査し、VS CodeのProblemsへ表示します。

Agentモードからは、次のLanguage Model Toolを明示的に参照できます。

- `#totonoeKnowledgeSave`: 会話で整理した内容を、確認付きでMarkdownへ保存
- `#totonoeKnowledgeSearch`: 過去の仕様、調査、手順、既知問題を検索

Save Toolはファイル作成前にVS Codeの確認を要求します。Search Toolが返すMarkdownナレッジは未検証の資料として扱い、状態・適用範囲・根拠を確認するようモデルへ通知します。

## セキュリティ境界

このGitHubリポジトリは機能のソースコードを公開する場所です。実際の社外秘ナレッジは、この公開リポジトリへ保存しないでください。社内Git、privateリポジトリ、またはアクセス制御されたローカルワークスペースを別に用意してください。

テンプレート生成は外部通信を行いません。Language Model生成を選ぶと、登録元テキストがユーザーの選択したVS Code Language Model Providerへ送信されます。送信前と保存前に秘密情報らしい文字列を検査して警告しますが、検出には誤りや見逃しがあります。

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

`npm run package` は型チェック、23件以上のユニットテスト、Extension Host向けバンドルを実行します。`npm run test:integration` はVS Code Stableを起動し、activate・コマンド・Tool・Problems診断を確認します。Pull Requestと`main`へのpushでも両方をGitHub Actionsで実行します。

VS Codeでこのフォルダーを開き、`F5`を押すとExtension Development Hostで実行できます。

### ActionsのVSIXを試す

Marketplace公開前のdogfoodingでは、GitHub Actionsの成功したrunから `totonoe-knowledge-vsix-<commit SHA>` artifactを取得できます。zipを展開し、VS CodeのExtensionsビューにある `Install from VSIX...` からインストールしてください。

artifactは14日間保存されるpre-alphaビルドです。機密ナレッジを扱う前に、対象commitと [SECURITY.md](SECURITY.md) を確認してください。MarketplaceやGitHub Releaseへの自動公開は行いません。

## 設定

| 設定 | 既定値 | 説明 |
|---|---:|---|
| `totonoeKnowledge.repositoryPath` | `knowledge` | ワークスペース内のMarkdown保存先 |
| `totonoeKnowledge.generator` | `ask` | `ask` / `template` / `languageModel` |
| `totonoeKnowledge.secretScanning.enabled` | `true` | 外部送信前と保存前の秘密情報候補検査 |

保存先にはワークスペース内の相対パスだけを指定できます。

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

## v0.1の状態

実装済み:

- 拡張機能の初期構成
- クリップボード／選択範囲からの登録
- AIなしテンプレートと交換可能なGenerator境界
- VS Code Language Modelによる構造化生成
- 外部送信前／保存前の秘密情報候補警告
- 重み付きMarkdown全文検索
- ユニットテストとGitHub Actions
- Agent向けSave/Search Language Model Tool
- ナレッジ整合性検査とProblems連携
- 実Extension Host統合テスト

残っている完成条件は、機密データを公開リポジトリから分離した環境で10〜30件を実際に登録し、操作性と検索品質を評価するdogfoodingです。手順は [docs/DOGFOODING.md](docs/DOGFOODING.md) にあります。

コマンドとLanguage Model Toolの手動確認項目は [docs/MANUAL_TEST.md](docs/MANUAL_TEST.md) にあります。

全体計画は [docs/ROADMAP.md](docs/ROADMAP.md) を参照してください。

## コントリビューション

[CONTRIBUTING.md](CONTRIBUTING.md) と対象Issueの受け入れ条件を確認してください。外部通信や機密情報の境界を変えるPull Requestでは、その影響を明記してください。

## ライセンス

[MIT License](LICENSE)
