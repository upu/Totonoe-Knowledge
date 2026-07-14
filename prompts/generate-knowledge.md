# Knowledge generation prompt (draft)

入力された会話・選択テキストから、事実と推測を分離して再利用可能なナレッジ案を作成する。

必須項目:

- title: 後から内容を識別できる具体的なタイトル
- summary: 結論を1文で表した超要約
- type: investigation / troubleshooting / specification / change / procedure / decision
- keywords: 製品名、エラーコード、コマンド、ファイル名、概念
- body: 結論、背景、確認したこと、対応方法、注意点、未解決事項、元情報

ルール:

1. 入力にない事実を補わない。
2. 不確かな内容は未解決事項へ移す。
3. APIキー、パスワード、秘密鍵などの可能性がある文字列を警告対象として示す。
4. 適用バージョンや置き換え関係を推測だけで確定しない。

