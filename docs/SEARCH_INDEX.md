# 検索インデックス

## 正本と派生データ

Markdown が唯一の正本です。次のファイルは検索を高速化する派生データで、削除・破損しても Markdown から再構築できます。

- `.totonoe/index.sqlite`: 全文検索用の SQLite FTS3 インデックス
- `.totonoe/vectors/index.json`: 意味検索用の正規化済みベクトル

両方とも Git 管理対象外です。Markdown 原文は保存しませんが、ファイルパス、検索用 n-gram、ベクトルを含むため、元ナレッジと同等の機密性があるものとして扱ってください。

## 全文検索

検索直前に Markdown の相対パス、更新時刻、サイズを比較し、追加・変更・削除分だけ SQLite へ反映します。日本語の空白なし自然文は 2・3 文字の部分列へ展開し、低情報な助詞・補助表現を除外します。SQLite から最大 200 件の候補を取得した後、Markdown を読み直し、タイトル、要約、キーワード、本文、type、status を重み付きで評価します。

SQLite がない、壊れている、または利用できない場合は、Markdown の直接検索へフォールバックします。対象バージョンを指定した検索では `supersedes` の推移関係を評価するため、全 Markdown を直接読みます。

## ハイブリッド検索

意味検索は初期状態では無効です。VS Code 設定 `totonoeKnowledge.embedding.provider` を `ollama` に変更すると、全文・メタデータ・意味の三つのスコアを結合します。

1. SQLite FTS から全文一致候補を取得する
2. クエリと各 Entry のベクトルのコサイン類似度から上位 50 件を取得する。既定ではモデル依存の絶対下限を設けない
3. 両候補集合を Markdown から読み直す
4. 候補集合内の最低・最高類似度を 0〜1 へ相対化する。さらに「1位と2位の差 ÷ 候補分布の全幅」を分布 confidence とし、相対意味scoreへ掛ける。複数候補が同値の平坦な分布では意味scoreを0とし、1件だけの場合は比較対象がないため意味scoreを維持する
5. 全文 45 点、メタデータ 10 点、confidence 適用後の意味 45 点を上限として合成する
6. 完全一致には 20 点を加え、エラーコードなどの明示検索を保護する

代表queryでは、単純な相対加点は平坦な候補分布でも1位へ意味45点を与え、期待Entryをlimit外へ押し出しました。RRFを含む順位fusionは両方の検索に現れるEntryを上げられる一方、類似度分布の確信度を捨て、無関係なsemantic-only候補も結果に残します。分布 confidence は既存の加点と完全一致bonusを維持しながら、先頭候補が分布から分離している度合いを意味寄与へ反映します。固定のcosine閾値ではないため、モデルごとの絶対値の違いにも依存しません。

Quick Pick と Language Model Tool の結果には、使用した backend、合計 score、raw cosine、相対score、分布 confidence、1位margin、分布の全幅、各成分と Embedding Provider が表示されます。これにより、順位の理由をデバッグできます。

## ローカル Ollama の設定

Totonoe Knowledge はモデルを VSIX に同梱しません。利用者が管理する Ollama の `/api/embed` を使用します。

```json
{
  "totonoeKnowledge.embedding.provider": "ollama",
  "totonoeKnowledge.embedding.ollama.endpoint": "http://127.0.0.1:11434",
  "totonoeKnowledge.embedding.ollama.model": "embeddinggemma",
  "totonoeKnowledge.embedding.minimumSimilarity": -1
}
```

安全のため接続先は認証情報を含まない `http://localhost`、`http://127.0.0.1`、`http://[::1]` のいずれかに限定しています。その他のホストや HTTPS URL は拒否し、全文検索へ切り替えます。Ollama の停止、モデル未取得、応答不正、タイムアウト、ベクトル次元不一致の場合も、検索そのものは失敗させず全文検索へフォールバックします。

ベクトルはモデル名と Markdown の fingerprint を持ち、追加・変更された Entry だけを最大 16 件ずつ生成します。モデルを変更した場合、破損した場合、またはキャッシュを削除した場合は再構築します。キャッシュには Embedding 入力の Markdown 原文を保存しません。

## 現在の制約

- Embedding 処理は明示的に `ollama` を選択した場合だけ実行します。
- モデルの取得と Ollama の起動は利用者が行います。
- fingerprint は更新時刻とファイルサイズです。
- SQLite とベクトルの派生データは処理時にメモリへ読み込まれます。
- `minimumSimilarity` は既定値 `-1` で絶対下限を無効にします。ノイズを抑えるため明示設定する場合は、使用モデルとナレッジ集合の代表クエリで比較して調整してください。
