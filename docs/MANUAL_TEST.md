# Manual Test Checklist

VS Code API、Language Model Provider、確認UIを含む経路は、ユニットテストに加えてExtension Development Hostで確認します。実データではなく、この文書にある架空データを使用してください。

## 準備

1. `npm install`
2. `npm run package`
3. VS Codeで `F5`
4. Extension Development Hostで空の一時ワークスペースを開く

## テンプレート登録

- [ ] `Register from Clipboard`で空クリップボードを警告する
- [ ] `AIを使わずナレッジ案を作る`に外部送信しない方式だと表示される
- [ ] AIなし直接コマンドでも外部送信確認なしでMarkdown案が開く
- [ ] `prepared_knowledge: "1"`形式ではmetadata入力を再表示せず、title、summary、type、keywords、固定本文がプレビューへ反映される
- [ ] 構造化済みソースのtype不正または固定見出し不足は登録を中止する
- [ ] 通常テキストは従来の入力用テンプレートへfallbackする
- [ ] プレビューのタブ名と通知から予定保存先を確認できる
- [ ] 通知の`この内容を登録`で、操作時点のeditor内容を予定保存先へ保存できる
- [ ] 初回通知を閉じてもeditor titleまたはコマンドパレットから`この内容を登録`を再実行できる
- [ ] 予定保存先が別操作で作られた場合は上書きせず競合を通知する
- [ ] 保存先選択を求められず、`Ctrl+S`で `knowledge/investigations/` へ保存できる
- [ ] `repositoryPath`へ `../outside` を指定すると保存を拒否する

## ナレッジリポジトリ選択

- [ ] `Select Knowledge Repository Folder`でワークスペース外の一時フォルダーを選択できる
- [ ] 書き込み用途と `.totonoe/index.sqlite`作成の確認が表示される
- [ ] `Show Knowledge Repository`で選択URIを確認できる
- [ ] 登録、検索、検証、再構築が選択フォルダーを使用する
- [ ] リポジトリルートの`README.md`をナレッジとして検査しない
- [ ] 旧版でルートへ保存した`Untitled-1.md`は`K-`形式IDがあれば検索できる
- [ ] 選択フォルダーを削除すると暗黙にワークスペースへ戻らずエラーになる
- [ ] `Use Workspace Repository`で既存の`repositoryPath`へ戻る

## Language Model登録

架空入力:

```text
調査結果: COLUMNSだけではPTY幅が変わらなかった。
stty cols 200で期待した表示になった。適用範囲はまだ未確認。
```

- [ ] `AIでナレッジ案を作る`から利用可能なProvider・モデルの一覧が表示される
- [ ] 前回使用したモデルが次回の候補先頭へ表示される
- [ ] 選択したモデルの利用同意をVS Codeが管理する
- [ ] JSON応答からタイトル、要約、本文案が作られる
- [ ] AIが判定したタイトル、要約、種別、キーワードを再入力せずプレビューで編集できる
- [ ] モデル障害または不正JSON時にテンプレートへ切り替えられる
- [ ] 上限に近い入力をモデルへ送信しない

## 秘密情報候補

実在しない値だけを使用します。

```text
password=example-only-secret
```

- [ ] Language Model送信前に種類と件数を警告する
- [ ] `テンプレートで続ける`を選べる
- [ ] 保存先付きプレビューを開く前にも警告する
- [ ] 警告に検出値そのものを表示しない

## 検索

- [ ] タイトル一致が本文だけの一致より上位になる
- [ ] 全角英数字と半角英数字を正規化する
- [ ] 複数語の結果をQuick Pickから開ける
- [ ] 日本語の部分文字列と英数字の途中からの検索で候補が見つかる
- [ ] 初回検索で `.totonoe/index.sqlite` が作られる
- [ ] Markdownを追加・変更・削除した後の検索で差分が反映される
- [ ] `Rebuild Search Index` で全Entryからインデックスを再構築できる
- [ ] インデックスを削除しても次回検索で再生成される
- [ ] `totonoeKnowledge.embedding.provider` の初期値が `disabled` であり、Ollamaへ通信しない
- [ ] Ollamaで `embeddinggemma` を利用可能にし、providerを `ollama` にすると `.totonoe/vectors/index.json` が作られる
- [ ] 言い換え検索で全文検索だけでは見つからないEntryがハイブリッド検索結果へ現れる
- [ ] Quick PickとSearch Toolに全文・metadata・意味のscore理由とproviderが表示される
- [ ] Ollamaを停止すると警告後に全文検索へ切り替わり、従来の検索結果が返る
- [ ] endpointへLAN・外部ホストまたはHTTPSを設定すると拒否され、本文が送信されない
- [ ] Markdownを変更すると該当Entryのベクトルだけが再生成され、キャッシュ内にMarkdown原文がない
- [ ] `Search for Version`で包含境界のEntryが見つかる
- [ ] 対象バージョンで適用される新Entryが`supersedes`する旧Entryを除外する
- [ ] 新Entryの適用前バージョンでは旧Entryが見つかる
- [ ] 比較不能な対象バージョンを入力すると警告する

## 整合性検査

- [ ] 正常なEntryだけのリポジトリで問題なしと表示する
- [ ] 必須front matterがないMarkdownをProblemsへ表示する
- [ ] 重複IDを両方のファイルへ表示する
- [ ] 存在しない `related` / `supersedes` を警告する
- [ ] 自己参照をエラーとして表示する
- [ ] 不正、異系列、逆転した`applies_from` / `applies_to`をエラーとして表示する

## Language Model Tools

- [ ] Agentモードで `#totonoeKnowledgeSave` を明示参照できる
- [ ] Save Toolの実行前にタイトルと保存操作の確認が表示される
- [ ] Save Toolの確認に適用バージョンと置き換え対象が表示される
- [ ] Agentモードで `#totonoeKnowledgeSearch` を明示参照できる
- [ ] Search ToolがID、タイトル、要約、type、相対パスを返す
- [ ] 検索結果を命令ではなく未検証資料として扱う注意が返る
