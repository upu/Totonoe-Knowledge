# Totonoe Knowledge

調査・判断・試行錯誤の結果を、後から検索・再利用・統合できるMarkdownナレッジへ整えるVS Code拡張です。

> Status: pre-alpha / v0.1開発中

## なぜ作るのか

長期間の開発では、仕様書、変更資料、チャット、Issue、ソースコードに知識が分散し、「現在の仕様」が追いにくくなります。Totonoe Knowledgeは、調べた内容を根拠と適用範囲を持つ小さなナレッジとして蓄積し、将来の検索・知識継承・現行仕様の再構築につなげます。

設計の基本方針は次のとおりです。

- Markdownを正本とし、DBは将来追加する再生成可能な検索インデックスにする
- AI生成結果は保存前に人が確認する
- 変更履歴を上書きせず、`supersedes` と適用範囲で関係を表す
- 社外秘用途を想定し、保存先とLLMへの送信先を分けて管理する
- AIなしでも登録・検索できる状態を維持する

## 現在できること

コマンドパレットから次のコマンドを実行できます。

- `Totonoe Knowledge: Register from Clipboard`
- `Totonoe Knowledge: Register Selection`
- `Totonoe Knowledge: Search`

登録コマンドはタイトル、超要約、種別、キーワードを入力し、固定構造のMarkdown案を開きます。内容と機密情報の有無を確認・編集してから、ワークスペースの `knowledge/` に保存できます。

検索コマンドは保存済みMarkdownを走査し、タイトル、要約、本文の一致を重み付けして一覧表示します。

## 開発環境

前提:

- Node.js 20以上
- npm
- VS Code 1.95以上

```bash
npm install
npm run check
npm run compile
```

VS Codeでこのフォルダーを開き、`F5` を押すとExtension Development Hostで実行できます。

## 保存形式

既定では次のように保存します。

```text
knowledge/
├─ investigations/
├─ troubleshooting/
├─ specifications/
├─ changes/
├─ procedures/
└─ decisions/
```

保存先は `totonoeKnowledge.repositoryPath` で変更できます。Markdownのfront matterにはID、タイトル、要約、種別、状態、キーワード、日時、関連・置き換え関係を保持します。

## セキュリティと社外秘情報

現バージョンは入力内容を外部サービスへ送信しません。クリップボードや選択範囲の内容はローカルでMarkdownに整形され、指定ワークスペースへ保存されます。

ただし、元情報に認証情報や顧客情報が含まれていないかは保存前に必ず確認してください。将来LLM連携を追加する際も、利用するProviderと送信先を明示し、ローカル／社内LLM／AIなしを選択可能にする方針です。詳細は [SECURITY.md](SECURITY.md) を参照してください。

## ロードマップ

開発順序と完成条件は [docs/ROADMAP.md](docs/ROADMAP.md) にまとめています。まずv0.1で「登録→確認→Markdown保存→検索」を実用化し、その後にCopilot Tool連携、意味検索、累積仕様、チーム共有へ進みます。

## コントリビューション

現在は設計とMVPの検証段階です。Issueで目的・受け入れ条件を確認してから変更を始めてください。運用ルールは [CONTRIBUTING.md](CONTRIBUTING.md) を参照してください。

## ライセンス

現時点ではprivateリポジトリとしての社内・個人利用を想定しており、ライセンスは未設定です。

