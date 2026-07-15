# AIなしの構造化済みナレッジ登録

Codex、ローカルLLM、人手、別の社内処理などで既に整理した内容は、`prepared_knowledge: "1"`形式のMarkdownへすると、VS Code Language Modelを呼ばずにTotonoe Knowledgeの確認・保存フローへ渡せます。

## 入力形式

```markdown
---
prepared_knowledge: "1"
title: "Markdownを正本にする"
summary: "検索DBは再生成可能な派生物として扱う"
type: decision
keywords:
  - "Markdown"
  - "SQLite"
---

# 結論

Markdownを正本にする。

# 背景

DBがなくても読める必要がある。

# 確認したこと

- Gitで差分をreviewできる
- indexを再生成できる

# 対応方法

EntryをMarkdownで保存する。

# 注意点

- indexも機密情報として扱う

# 未解決事項

- なし
```

次の条件をすべて満たす必要があります。

- `prepared_knowledge`は文字列`"1"`
- `title`と`summary`は空でない文字列
- `type`は`investigation`、`troubleshooting`、`specification`、`change`、`procedure`、`decision`のいずれか
- `keywords`は1件以上の文字列を持つYAMLリストまたはJSON形式のinline list
- 6つの固定見出しがすべて存在する
- `確認したこと`、`注意点`、`未解決事項`は1件以上の箇条書きを持つ

ID、status、作成日時、保存pathは入力に書かず、登録時に拡張機能が生成します。`applies_from`、`applies_to`、`related`、`supersedes`は保存前のMarkdownプレビューで根拠とともに編集します。

## 登録手順

1. `Select Knowledge Repository Folder`で保存先を選び、`Show Knowledge Repository`で確認する
2. 構造化済みMarkdownファイルを開いて全文選択する
3. `Totonoe Knowledge: AIを使わず選択範囲から登録`を実行する
4. title、summary、type、keywordsの再入力画面を挟まず、保存先付きMarkdownプレビューが開くことを確認する
5. プレビューで本文とfront matterを確認・編集する
6. `この内容を登録`を実行する。通知を閉じた場合はeditor titleまたはコマンドパレットから再実行でき、`Ctrl+S`でも保存できる
7. `Validate Repository`と`Search`で確認する

クリップボードへコピーして`AIを使わずクリップボードから登録`を実行しても同じです。この経路は`vscode.lm`を呼ばず、外部送信を行いません。構造化済みソースも未信頼入力として扱い、既存の秘密情報候補検査と人による確認を省略しません。

prepared、通常template、AI生成は登録フロー上で区別します。preparedとAI生成は解析・生成済みmetadataを再入力させずプレビューへ進みます。`prepared_knowledge`がない通常テキストだけは、従来どおりtitleの初期値を作り、summary、type、keywordsと本文を人が入力します。構造化済みを宣言した入力に不正なtypeや不足見出しがある場合は、空テンプレートへfallbackせず登録を中止します。
