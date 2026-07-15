# 開発ロードマップ

## プロダクト原則

Totonoe Knowledgeの中心はチャット履歴の保存ではなく、調査結果を再利用可能な知識へ変換することです。

データは次の3層に分けます。

1. Evidence: 元のチャット、文書、Issue、コミット、ソースコード
2. Knowledge Entry: 個別の調査、変更、決定、手順
3. Current View: 複数Entryから承認付きで生成する現在仕様

Markdownを正本とし、検索DBやベクトルはいつでも再構築できる派生物として扱います。

## v0.1 — Local MVP

目的: 自分の調査を無理なく登録し、後日検索できる一連の流れを完成させる。

現在の状態: 完了。12件の実データdogfooding、登録UX改善、12検索queryの回帰テスト、内容品質再レビュー、粒度ガイドラインまで実施済み。

### M1: 保存できる

- VS Code拡張の初期構成
- クリップボード／選択範囲から登録
- 固定テンプレートによるMarkdown案生成
- 保存前の確認・編集
- 種別別ディレクトリへの保存
- 保存先設定
- ワークスペース外のナレッジリポジトリ選択

完成条件: Copy Allした会話をコマンドからMarkdownとして保存できる。

### M2: AIで整えられる

- 交換可能な `KnowledgeGenerator` インターフェース
- VS Code Language Model API連携
- 構造化出力の検証と失敗時フォールバック
- AIなしのテンプレートモード
- 秘密情報らしい文字列の警告

完成条件: AI案を人が確認・編集し、外部送信先を把握した上で保存できる。

### M3: 探せる

- Markdown全文検索
- タイトル、要約、キーワード、本文の重み付け
- Quick Pickでの結果表示
- 対象ファイルを開く
- 検索品質のテストデータ

完成条件: 10〜30件の実データから過去の調査を再発見できる。

### M4: Dogfooding

- 登録操作の摩擦を計測
- 要約粒度と固定見出しを評価
- メタデータの過不足を確認
- ナレッジ粒度のガイドラインを作成

完成条件: 継続利用の判断とv0.2の仕様がIssueとして整理されている。

完了結果: 12件を登録し、修正後は代表検索12件すべてで期待EntryをQuick Pick上位4件以内に再発見できた。登録UXの改善はIssue #37〜#39で完了し、次の実装対象はIssue #8とする。

実施手順と、公開コードから機密ナレッジを分離する方法は [DOGFOODING.md](DOGFOODING.md) を参照する。

## v0.2 — Copilot Tool連携

- `#totonoeKnowledgeSave`
- `#totonoeKnowledgeSearch`
- Agentモードへ検索結果と参照リンクを返す
- Toolの明示呼び出しを先行し、自動呼び出しは利用データを見て判断

現在の状態: Save/Search Toolと保存確認、Extension Host統合テスト、Markdown整合性検査を実装済み。v0.1 dogfoodingの改善は反映済みで、実Copilot AgentでのTool参照確認が残っている。

## v0.3 — ハイブリッド検索

- SQLite FTSによる全文検索インデックス（実装済み）
- ローカルEmbedding Provider
- 全文＋意味＋メタデータのハイブリッドランキング
- 関連・重複候補の提示

現在の状態: Markdownを正本とするSQLite FTS3インデックス、増分同期、全再構築、直接検索フォールバックを実装済み。ローカルEmbedding Providerとハイブリッドスコアリングが残っている。

## v0.4 — 累積仕様

- 適用バージョンと `supersedes`
- Duplicate / Related / Complement / Conflict / Supersede候補
- 人間の承認を伴うCurrent View生成
- 元Evidenceへ戻れる追跡性

現在の状態: 包含境界の適用バージョン、`supersedes`整合性検査、対象バージョンでの有効Entry検索を実装済み。矛盾候補と承認付きCurrent View生成が残っている。

## v0.5 — チーム共有

- 共有Gitリポジトリ＋各PCのローカルインデックス
- Pull Requestによるナレッジレビュー
- HTTP Repository / MCPサーバ
- 権限管理と監査ログ
- バックアップ、インポート、エクスポート

現在の状態: 認証・認可、project境界、MCP Toolの情報量、監査event、可読export、restoreの実装前契約をIssue #14で文書化済み。server実装はこの契約とthreat modelを満たしてから有効化する。

Git共有については、個人/チームRepositoryの明示切替、pull後の増分index更新、PR review、classification/access運用をIssue #13で文書化済み。現在は複数Repositoryの同時横断検索を行わない。

## 初期スコープ外

- 通常のCopilot Chatセッションの直接取得
- 完全自動登録・完全自動統合
- 初期段階からの中央DBサーバ
- AI判断だけによる適用バージョン・置き換え関係の確定
- 外部送信先が不明な状態での機密情報処理
