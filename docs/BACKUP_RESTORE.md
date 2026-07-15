# Backup / Export / Restore Runbook

Status: Issue #14の実装前運用要件。remote backup機能は未実装です。

## 保護対象

| 対象 | 正本 | 方針 |
|---|---|---|
| Knowledge Markdownと履歴 | Git remote | mergeごとのremote複製と定期mirror |
| DBなしで読めるproject export | Markdown archive | 定期生成、暗号化、別障害ドメインへ保管 |
| project ACL / classification policy | Repository gateway config store | Knowledgeとは別に暗号化backup |
| audit event | append-only audit sink | Repository writerから削除できない保持先 |
| SQLite/vector index/cache | 派生物 | backupしない。Markdownから再生成 |
| OAuth token / secret | Authorization Server / secret store | exportへ含めない。各基盤のrunbookに従う |

組織policyが未定の場合の開始点は、Git mirrorをmergeごと、可読exportとACL backupを1日1回、restore drillを四半期ごととします。RPO/RTO、保持世代、法的保持は情報所有者と基盤管理者が決定し、projectごとに記録します。

## 可読export形式

```text
totonoe-export-{project}-{timestamp}/
├─ README.md
├─ manifest.json
├─ checksums.sha256
├─ signatures/
│  └─ manifest.sig
└─ knowledge/
   ├─ investigations/
   ├─ specifications/
   ├─ procedures/
   ├─ decisions/
   ├─ changes/
   └─ troubleshooting/
```

`manifest.json`は次の値だけを持ちます。

```json
{
  "schema_version": 1,
  "export_id": "uuid",
  "project_id": "project-a",
  "classification": "confidential",
  "created_at": "RFC3339 UTC",
  "source_commit": "full Git SHA",
  "entry_count": 120,
  "hash_algorithm": "SHA-256",
  "generator_version": "x.y.z"
}
```

- Markdown、README、manifest、checksum listは通常のファイルとして読めるようにする
- `.totonoe/index.sqlite`、vector、cache、Git credential、token、server config、audit eventを含めない
- archive全体を暗号化し、鍵をarchiveと別のKMS/secret管理へ置く
- manifest/checksumへ改ざん検知可能な署名を付け、restore前に検証する
- export生成とdownloadを`knowledge:export` + project policyで制限し、audit eventを残す
- object storageのdownload referenceを使う場合はsingle-use、5分以内、URLをログへ残さない

## Backup手順

1. protected branchと全tagを含むGit mirrorを別account/regionまたは別failure domainへ同期する
2. source commitを固定して可読exportを生成する
3. Entry数、Knowledge validation、secret policyを検査する
4. SHA-256 checksumと署名を生成する
5. 暗号化して別failure domainへ保存する
6. 保存後にarchiveを再読込し、署名、checksum、manifest、Entry数を検証する
7. 成否、project、source commit、export ID、byte数をaudit eventへ記録する。本文と保存先credentialは記録しない

partial backupは成功として扱いません。audit sinkへ記録できない場合もbackup jobを失敗にします。

## Restore手順

productionへ直接展開せず、隔離環境で次の順序を守ります。

1. インシデント指揮者、project owner、復旧担当者を記録し、production writeを停止する
2. 復旧点のsource commit/export IDと、失う可能性がある変更範囲をownerが承認する
3. archiveを隔離環境へ取得し、署名、checksum、manifest、暗号化状態を検証する
4. project ID、classification、source commit、Entry数が復旧依頼と一致することを確認する
5. Git mirrorの場合は`git fsck`相当を実行し、branch/tagをproductionと比較する
6. Markdownを新しい空Repositoryへ展開し、`Validate Repository`相当でschema、ID重複、reference、version範囲、supersedes cycleを検査する
7. secret scannerとmalware/attachment policyを再適用する
8. SQLite/vector indexをMarkdownから新規生成する。backup中のindexを再利用しない
9. Entry数、type別件数、既知IDのsample、通常検索、version指定検索を照合する
10. ACL/classification policyを別backupから復元し、最小権限であることをreviewする
11. read-onlyで切り替え、project ownerがsample確認した後にwriteを再開する
12. restore event、復旧点、検証結果、承認者をaudit sinkへ記録し、事後レビューを行う

checksum/署名不一致、未知schema version、project不一致、validation error、secret incidentがある場合はfail closedとし、productionへ反映しません。

## SecretがGit履歴へ入った場合

1. 先にcredentialを失効・rotationし、漏えい範囲を調査する
2. 通常のEntry更新だけで「削除済み」と判断しない。Git履歴、mirror、export、CI artifactにも残り得る
3. 組織のインシデント手順に従い、履歴書き換えの要否、backupの隔離・期限切れ、監査証跡の保持を決定する
4. 履歴を書き換えた場合は古いclone/mirrorから再混入しないよう、全利用者と自動処理を再同期する
5. secret実値をIssue、commit message、audit event、復旧記録へ複製しない

## Restore drillの完成条件

- production accessなしで最新の承認済みbackupを復号できる
- 署名と全checksumを検証できる
- Git/Markdownからindexを再生成できる
- Entry件数とsample検索結果が期待値と一致する
- ACLを復元するまでKnowledgeを公開しない
- 実測RPO/RTO、失敗箇所、改善Issueを記録できる
