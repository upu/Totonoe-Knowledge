# 適用バージョンと置き換え関係

変更点の履歴を消さず、特定バージョンで有効なKnowledge Entryを判定するため、適用範囲と`supersedes`を使用します。

## front matter

```yaml
applies_from: "17.1"
applies_to: "17.9"
supersedes:
  - "K-20260710-001"
```

- `applies_from`: 適用開始バージョン。境界を含む
- `applies_to`: 適用終了バージョン。境界を含む
- 空文字またはフィールドなし: その方向の制限なし
- `supersedes`: このEntryが明示的に置き換える過去EntryのID

既存Entryに`applies_from` / `applies_to`がない場合は全バージョンに適用されるため、既存Markdownの一括移行は不要です。

## 比較できるバージョン

数値セグメントを末尾に持つ版表記を比較します。

```text
17
17.1.2
v17.1
RHEL9.2
release-v3
```

数値セグメントは数値として比較するため、`17.2`は`17.10`より前です。末尾の不足セグメントは0として扱い、`1`と`1.0.0`は同じです。

製品系列を表す接頭辞は正規化した上で一致を必須にします。`RHEL9`と`Ubuntu9`は比較しません。`rolling`や`1.2-beta`のように順序を一意に決められない表記は現在未対応です。

## バージョン指定検索

`Totonoe Knowledge: Search for Version`を実行し、対象バージョンと検索語を入力します。Search Toolでは任意の`version`引数を使用できます。

1. 対象バージョンが`applies_from`以上、`applies_to`以下のEntryだけを残す
2. 残ったEntryの`supersedes`を推移的にたどる
3. 置き換え済みEntryを除外する
4. 通常のタイトル・要約・キーワード・本文ランキングを行う

関係グラフ全体を評価する必要があるため、バージョン指定検索は現時点ではSQLite候補だけでなくMarkdown全件を読みます。通常検索は従来どおりSQLite FTSを使用します。

## 人間による確定

AI生成には適用範囲や置き換え関係を推測させません。

- 通常登録では、生成されたfront matterの空欄を人が編集する
- Save Toolでは、ユーザーまたは根拠が明示した値だけを任意引数として渡す
- Save Toolの確認画面に適用範囲と置き換え対象を表示する
- 不明な場合は空欄のまま保存し、後から根拠とともに更新する

過去Entryは削除・上書きせず履歴として残します。`supersedes`の自己参照、未知ID、重複、循環は`Validate Repository`で検査します。
