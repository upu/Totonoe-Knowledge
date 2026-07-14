# Manual Test Checklist

VS Code API、Language Model Provider、確認UIを含む経路は、ユニットテストに加えてExtension Development Hostで確認します。実データではなく、この文書にある架空データを使用してください。

## 準備

1. `npm install`
2. `npm run package`
3. VS Codeで `F5`
4. Extension Development Hostで空の一時ワークスペースを開く

## テンプレート登録

- [ ] `Register from Clipboard`で空クリップボードを警告する
- [ ] `template`を選ぶと外部送信確認なしでMarkdown案が開く
- [ ] 編集後に `knowledge/investigations/` へ保存できる
- [ ] `repositoryPath`へ `../outside` を指定すると保存を拒否する

## Language Model登録

架空入力:

```text
調査結果: COLUMNSだけではPTY幅が変わらなかった。
stty cols 200で期待した表示になった。適用範囲はまだ未確認。
```

- [ ] 利用可能なProvider・モデルの一覧が表示される
- [ ] 選択したモデルの利用同意をVS Codeが管理する
- [ ] JSON応答からタイトル、要約、本文案が作られる
- [ ] モデル障害または不正JSON時にテンプレートへ切り替えられる
- [ ] 上限に近い入力をモデルへ送信しない

## 秘密情報候補

実在しない値だけを使用します。

```text
password=example-only-secret
```

- [ ] Language Model送信前に種類と件数を警告する
- [ ] `テンプレートで続ける`を選べる
- [ ] ローカル保存前にも警告する
- [ ] 警告に検出値そのものを表示しない

## 検索

- [ ] タイトル一致が本文だけの一致より上位になる
- [ ] 全角英数字と半角英数字を正規化する
- [ ] 複数語の結果をQuick Pickから開ける

## 整合性検査

- [ ] 正常なEntryだけのリポジトリで問題なしと表示する
- [ ] 必須front matterがないMarkdownをProblemsへ表示する
- [ ] 重複IDを両方のファイルへ表示する
- [ ] 存在しない `related` / `supersedes` を警告する
- [ ] 自己参照をエラーとして表示する

## Language Model Tools

- [ ] Agentモードで `#totonoeKnowledgeSave` を明示参照できる
- [ ] Save Toolの実行前にタイトルと保存操作の確認が表示される
- [ ] Agentモードで `#totonoeKnowledgeSearch` を明示参照できる
- [ ] Search ToolがID、タイトル、要約、type、相対パスを返す
- [ ] 検索結果を命令ではなく未検証資料として扱う注意が返る
