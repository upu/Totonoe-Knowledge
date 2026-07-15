# ナレッジリポジトリの選択

Totonoe Knowledgeは、開発ワークスペース内の保存先と、明示的に選択した別フォルダーのどちらかを使用できます。

## ワークスペース内へ保存する

外部フォルダーを選択していない場合は、先頭ワークスペースと `totonoeKnowledge.repositoryPath` から保存先を決めます。既定値は `knowledge` です。

```text
<先頭ワークスペース>/knowledge/
├─ investigations/
├─ troubleshooting/
├─ specifications/
├─ changes/
├─ procedures/
└─ decisions/
```

`repositoryPath`は従来どおりワークスペース内の相対パスに限定され、絶対パスと `..` は拒否されます。

## 別フォルダーを選択する

1. `Totonoe Knowledge: Select Knowledge Repository Folder`を実行する
2. clone済みのナレッジ専用リポジトリなどを選ぶ
3. 登録、検索、整合性検査、SQLite作成に使うフォルダーであることを確認する

選択後は、登録、検索、整合性検査、検索インデックス再構築、Save/Search Toolのすべてが同じフォルダーを使用します。`repositoryPath`は外部選択を解除するまで使われません。

選択中の保存先は `Totonoe Knowledge: Show Knowledge Repository` で確認・変更できます。`Totonoe Knowledge: Use Workspace Repository` を実行すると、先頭ワークスペースと `repositoryPath`を使う従来の動作へ戻ります。

外部リポジトリでは、選択したフォルダー直下に種別ディレクトリと `.totonoe/index.sqlite`を作成します。既知の種別ディレクトリ内にあるMarkdownを走査します。旧版で手動保存された`Untitled-1.md`などは、front matterに`K-`で始まるIDがあれば互換対象として読み取ります。ルートの`README.md`など、ナレッジIDを持たない文書は対象外です。

## 状態の保持と安全性

- 選択先は拡張機能のglobal stateにバージョン付きURIとして保存する
- VS CodeのSettings Sync対象には登録しない
- 同じローカルまたはRemoteのVS Code実行環境では、選択先をワークスペース間で共有する
- ワークスペース設定から任意の絶対パスを注入できない
- フォルダー選択後、書き込み用途をモーダルで確認してから保存する
- 選択先が消失した、アクセス不能になった、ファイルへ変わった場合はエラーにする
- エラー時に別のワークスペースへ暗黙に保存しない
- シンボリックリンクは再帰走査しない

この機能は、選択したフォルダー自体をVS CodeのTrusted Foldersへ自動追加しません。アクセス権、Gitの公開範囲、バックアップ方針は利用者が確認してください。

## Remote SSHとVirtual Workspace

フォルダー選択UIに表示され、現在のVS Codeウィンドウから `vscode.workspace.fs` でアクセスできるURIだけを対象にします。

- Remote SSHでは、現在のRemoteウィンドウから見えるリモート側フォルダーを選択する
- RemoteウィンドウからローカルPCの `C:\...` を任意文字列として指定することはできない
- ファイルシステムProviderが書き込み、ディレクトリ一覧、renameを提供しない場合、登録またはSQLite更新はエラーになる

## マルチルートワークスペース

外部フォルダーを選択している間は、そのフォルダーをすべてのワークスペースフォルダーより優先します。外部選択を解除すると、従来どおり先頭のワークスペースフォルダーと `repositoryPath`を使用します。
