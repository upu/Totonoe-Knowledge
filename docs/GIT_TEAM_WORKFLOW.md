# Git / Pull Request チームナレッジ運用

このガイドは、Markdownを正本にしたチームナレッジを社内Gitで共有し、各PCのローカルindexで検索する最小運用を定義します。Totonoe Knowledge自体の公開範囲と、保存するKnowledge Repositoryの公開範囲は別です。社外秘を含むRepositoryは組織が管理するprivate/internal Gitへ置いてください。

## Repositoryを分ける

```text
personal-knowledge/       owner: individual
└─ knowledge Markdown

team-knowledge/           owner: team / company
└─ reviewed knowledge Markdown
```

- 個人用とチーム用は別Repository、別clone、別ACLにする
- source code Repositoryとも分けられる。productごとに権限が同じなら同居も可能だが、公開範囲の広い方へ合わせない
- `.totonoe/index.sqlite`は各cloneの派生物であり、共有・review・backupしない
- Git上のMarkdownだけでtitle、summary、本文、履歴、差分を読める状態を維持する

Totonoe Knowledgeは現在、1つのRepositoryだけを操作対象にします。`Select Knowledge Repository Folder`でpersonalまたはteamのcloneを選び、`Show Knowledge Repository`で確認してから登録・検索します。選択はそのPCのVS Code側に保存され、Settings Syncされません。personalとteamを同時に横断検索しないため、検索結果の由来とアクセス境界が曖昧になりません。

## Team Repositoryの初期構成

[templates/knowledge-repository](../templates/knowledge-repository) を新しいprivate/internal Repositoryへコピーし、次を決めます。

- Repository ownerとproject owner
- 既定classification
- contributor、reviewer、project admin
- required reviewer数とCODEOWNERS
- backup、保持期間、離任時の権限削除担当

`.gitignore`には最低限、次を含めます。

```gitignore
.totonoe/
```

Knowledgeのtype directoryは最初の登録時に自動作成されます。空directoryをGitへ登録する必要はありません。

## 読み取りとpull後のindex更新

1. `Totonoe Knowledge: Show Knowledge Repository`でteam cloneを選択中か確認する
2. dirtyな変更がないことを確認する。未完了の編集は先にbranchへcommitする
3. team cloneで`git pull --ff-only`を実行する
4. 通常の`Search`を実行する

通常検索はMarkdownのpath、mtime、sizeを前回indexと比較し、追加・変更・削除だけをSQLiteへ反映します。indexは選択したRepositoryの`.totonoe/index.sqlite`にあり、Gitで共有しません。

次の場合は`Totonoe Knowledge: Rebuild Search Index`を実行し、全Markdownから再生成します。

- clone直後または大量のbranch切り替え後
- indexを削除・復旧した後
- pullした内容が検索へ出ない疑いがある
- validationやrestoreの確認中

SQLiteが壊れたり削除されたりしてもMarkdownは失われません。再構築できない場合も、通常検索はMarkdown直接検索へfallbackします。

## EntryをPull Requestで追加・更新する

1. team cloneのmainを`git pull --ff-only`で最新にする
2. `knowledge/<issue-or-id>-<slug>`のtopic branchを作る
3. team cloneをTotonoe Knowledgeの対象に選ぶ
4. 登録コマンドで生成・編集し、type/ID/titleから決まったpathへ保存する
5. `Validate Repository`を実行し、errorを0件にする
6. `git diff --check`と`git diff`でfront matter、本文、意図しない秘密・個人情報を確認する
7. commitしてpushし、[Knowledge用Pull Request template](../templates/knowledge-repository/.github/PULL_REQUEST_TEMPLATE/knowledge.md)でPRを作る
8. CODEOWNERSとbranch protectionでreviewとrequired checksを通してmergeする
9. merge後、作成者以外のPCでpullし、検索・Entry表示をsample確認する

拡張はGit commit、push、PR作成、承認、mergeを自動実行しません。生成AIの判断だけで現行仕様や`supersedes`を確定せず、PRのreview対象にします。

### Reviewer checklist

- titleとsummaryだけで結論を誤解しないか
- 結論、背景、確認したこと、対応方法、注意点、未解決事項が根拠と一致するか
- `type`、status、version範囲、related、`supersedes`が妥当か
- `supersedes`先を消さず、履歴として残しているか
- source referenceを閲覧できる人とRepository ACLが一致するか
- credential、顧客情報、社内host、個人情報が不要に含まれていないか
- classificationとprojectの既定policyが合っているか
- duplicate/conflict候補がないか

## 個人Knowledgeをteamへ移す

personal Repositoryからteam Repositoryへの移動は自動同期にしません。

1. 元情報をteamで共有してよいか、情報所有者とclassificationを確認する
2. team Repositoryへ切り替え、新しいEntryとして登録する
3. team向けにsource、絶対path、個人名、credential、顧客情報を削減する
4. PRでreviewし、承認後にmergeする
5. personal側を削除する必要がある場合は、そのRepositoryの保持・監査方針に従う

Entry IDをコピーするか新規発行するかはproject policyで統一します。両方のRepositoryを同時検索しないため、重複IDだけで別境界の情報が混ざることはありません。

## Accessとclassification

[Remote Repository / MCP セキュリティモデル](REMOTE_SECURITY_MODEL.md) のrole/classificationをGit運用にも適用します。

| Role | Git access |
|---|---|
| Reader | clone/read。branch push不可 |
| Contributor | topic branchまたはforkへpush。main直接push不可 |
| Reviewer | PR review。自分だけでのmergeはbranch policyで制限 |
| Project admin | ACL、branch protection、backup。Knowledge内容の単独承認者とは限らない |

- `internal`: project memberが閲覧できる
- `confidential`: 明示的に許可したmemberだけのRepository/projectへ置く
- `restricted`: 通常のteam Repositoryへ入れず、専用Repositoryと明示ACLを使う

人の異動・離任時はGit group、SSO session、service account、backup accessを同じchange ticketで削除します。共有PATや共通accountは使いません。権限変更と機密exportは監査対象にします。

## Conflictと緊急修正

- 同じEntryを複数branchで更新した場合は、機械的に本文を連結せず、根拠とversion範囲を確認して解決する
- `supersedes`の循環、未知ID、duplicate IDはmerge前に`Validate Repository`で解消する
- 緊急修正でもmain直接pushを既定にしない。例外を使った場合は事後PRとauditを残す
- secretをcommitした場合は、Entryを消す前にcredentialを失効し、Git履歴・mirror・artifactを含むincident対応を行う

## 現在の制約

- personal/teamの同時横断検索と、結果へのRepository badgeは未実装
- CLI validatorは未実装のため、CIからのKnowledge validationは今後の課題
- Git操作とアクセス権設定は利用者・Git platform側で行う
- Remote HTTP Repository / MCPサーバは未実装

この制約により、現時点の運用は「対象Repositoryを明示して、そこで登録・検索し、Git PRで共有する」形です。複数境界を暗黙に混ぜないことを優先します。

