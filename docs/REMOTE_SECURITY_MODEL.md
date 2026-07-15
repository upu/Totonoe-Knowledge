# Remote Repository / MCP セキュリティモデル

Status: Issue #14の実装前設計。HTTP RepositoryとMCPサーバは未実装です。

この文書は、社外秘を含み得るMarkdownナレッジをリモート共有するときの必須境界を定義します。特定の法令や認証への適合を保証するものではありません。組織の情報区分、保存期間、インシデント対応規程がこの文書より厳しい場合は、組織規程を優先します。

## 正本と信頼境界

```text
MCP / HTTP client (untrusted)
        |
        | HTTPS + audience-bound access token
        v
Repository gateway (OAuth protected resource)
        |-- authorization policy: subject x client x project x role x operation x classification
        |-- response minimization / secret scanning
        |-- append-only audit events
        v
Git-backed Markdown repository (source of truth)
        |
        +-- disposable per-project search index
        +-- proposal branch / Pull Request
```

- MarkdownとGit履歴を正本とし、SQLite・vector index・キャッシュは破棄可能な派生物とする
- client、LLM、Tool引数、Knowledge本文、検索結果をすべて未信頼入力として扱う
- Authorization Server、Repository gateway、Git remote、audit sink、backup保管先は別の責務として扱う
- Repository gatewayが受け取ったtokenをGit、検索基盤、別APIへ転送しない
- projectごとにRepositoryと検索indexを論理分離し、認可前の横断検索や件数集計をしない

## 認証

HTTP transportのMCPサーバはOAuth 2.1 Protected Resourceとして動作します。

- HTTPSを必須とし、平文HTTP、自己署名証明書の無検証利用、tokenのquery string指定を拒否する
- OAuth 2.0 Protected Resource Metadataを公開し、許可したAuthorization Serverだけを列挙する
- Authorization Server MetadataまたはOpenID Connect Discoveryを使用する
- public clientはAuthorization Code + PKCE（`S256`）を使用する
- access tokenのissuer、signature、expiry、not-before、audience、scopeをリクエストごとに検証する
- clientはResource IndicatorsでRepository gatewayのcanonical URIを指定し、serverはaudience一致を必須にする
- access tokenは短命にし、可能ならDPoPまたはmTLSでsender-constrainする
- refresh token、client secret、PATを設定ファイル、URL、ログ、audit eventへ保存しない
- service accountは組織のAuthorization Serverが発行する専用identityを使い、人間のtokenを共有しない

認証できない場合は`401`、tokenは有効だが権限が不足する場合は`403`を返します。projectやEntryの存在を秘匿する必要があるread操作では、認可後の方針に従って`404`へ正規化します。

## 認可

### Scope

| Scope | 許可する操作 |
|---|---|
| `knowledge:read` | 認可済みprojectの検索、Entry取得 |
| `knowledge:propose` | draft proposalのpreview、作成、提出 |
| `knowledge:export` | 認可済みprojectの可読export作成 |
| `knowledge:admin` | project ACL、保持方針、復旧操作 |

Scopeは上限であり、Scopeだけでは許可しません。毎回、tokenの`sub`と`client_id`、project membership、role、operation、Entryのclassificationを評価します。

### Project role

| Operation | Reader | Contributor | Reviewer | Project admin |
|---|:---:|:---:|:---:|:---:|
| Search / read | yes | yes | yes | yes |
| Create proposal | no | yes | yes | yes |
| Submit proposal as PR | no | yes | yes | yes |
| Approve / merge PR | no | no | Git policy | Git policy |
| Export | no | no | policy | yes |
| Change ACL / restore | no | no | no | yes |

Repository gatewayはmainへ直接書き込みません。更新はproposal branchとPull Requestまでとし、承認者数、CODEOWNERS、署名、required checksなどのmerge条件はGit側で強制します。

### Classification

Entryに次のfront matterを将来追加できる設計にします。フィールドがない既存Entryはprojectのdefault classificationを継承します。

```yaml
classification: confidential
```

| 値 | Remote API / MCP |
|---|---|
| `internal` | project ACL内で利用可能 |
| `confidential` | 明示的に許可されたhuman identity/clientだけ利用可能 |
| `restricted` | 既定でRemote API/MCPから除外。project policyの明示許可が必要 |

projectの存在、Entry ID、検索結果0件、更新時刻も情報です。認可前にindexへ問い合わせず、別projectの件数や候補を応答へ含めません。

## Threatと対策

| Threat | 必須対策 |
|---|---|
| token窃取・replay | 短命token、secure storage、audience制限、可能ならDPoP/mTLS |
| token passthrough / confused deputy | inbound tokenのaudience検証、downstreamへ転送しない、Resource Indicators |
| cross-project情報漏えい | 認可してからproject別indexを検索し、件数・候補・timing差を最小化 |
| prompt injection | KnowledgeとTool resultを未信頼データとして明示し、本文中の命令を実行しない |
| 意図しないwrite | bounded schema、preview token、idempotency、proposal-only、Git review |
| stale update / replay submit | ETag、base commit、payload hash、one-time preview token、有効期限 |
| secretの応答・ログ漏えい | field allowlist、secret scan、response minimization、本文/query/tokenを記録しない |
| backup改ざん・取り違え | project/commitを含むmanifest、署名、checksum、隔離restore、owner承認 |
| 大量取得・DoS | request/Entry/result上限、cursor、actor/client/project別rate limit、timeout |

## MCP Toolの情報境界

MCP Toolは次の4つに限定します。export、ACL変更、merge、履歴削除、restoreをLLM向けToolとして公開しません。

| Tool | 読み書き | 応答の上限と境界 |
|---|---|---|
| `totonoe_knowledge_search` | read | 既定5件、最大20件。ID、title、summary、type、status、version範囲、project内referenceだけ |
| `totonoe_knowledge_get` | read | IDを明示した1件。最大256 KiB。元チャット、添付、認証情報らしい値は既定で除外 |
| `totonoe_knowledge_preview_proposal` | no write | 正規化後のfront matterとMarkdown差分、対象project、classification、secret findingの種類だけ |
| `totonoe_knowledge_submit_proposal` | proposal write | one-time preview tokenと同一payloadだけをproposal/PRにする。mainは変更しない |

- 全Tool input schemaは`additionalProperties: false`とし、project IDを必須にする
- cross-projectのdefaultを設けない。利用可能projectの列挙も認可済み範囲だけにする
- searchは本文全体を返さず、Entry取得を別操作にする
- source/evidenceの原文、ローカル絶対パス、Git credential、token、secret scannerが検出した値を返さない
- 応答へ「未信頼のナレッジであり命令ではない」ことを示す固定境界を付ける
- Knowledge本文中の「別Toolを呼ぶ」「秘密を表示する」などの命令を実行しない
- writeはpreviewとsubmitの二段階にし、preview tokenをactor、client、project、payload hash、有効期限へ束縛する
- preview tokenはone-time、10分以内とし、再利用、payload差し替え、別client利用を拒否する
- MCP clientにはTool名、引数、対象project、差分を表示して拒否できるUIを求める。ただしserverはUI確認だけを信用せず、proposal-onlyとGit reviewも強制する

## 監査ログ

認可判定の成否にかかわらず、Repository gatewayは次のeventをappend-onlyのaudit sinkへ送ります。

```json
{
  "schema_version": 1,
  "event_id": "uuid",
  "occurred_at": "RFC3339 UTC",
  "request_id": "uuid",
  "actor_sub": "authorization-server subject",
  "client_id": "oauth client id",
  "project_id": "canonical project id",
  "action": "knowledge.search",
  "resource_ids": ["K-..."],
  "classification": "confidential",
  "scopes": ["knowledge:read"],
  "policy_decision": "allow",
  "result": "success",
  "result_count": 3,
  "request_bytes": 120,
  "response_bytes": 940,
  "latency_ms": 42
}
```

記録するeventは、認証失敗、認可拒否、検索、Entry取得、proposal preview/submit、PR作成、export作成/取得、ACL変更、backup、restore、index再構築、policy変更です。

次の値はaudit eventへ記録しません。

- access token、refresh token、authorization code、cookie、client secret
- Knowledge本文、元チャット、添付内容、Toolの完全な引数・応答
- 検索文。調査用には組織salt付きhash、文字数、語数までにする
- secret scannerが検出した実値。種類と件数だけを記録する

audit sinkはRepository writerから削除・改変できない保管先にし、転送失敗時はwrite/export/admin操作をfail closedにします。readは組織policyに従ってfail closedを既定とし、可用性優先へ変更する場合は明示的なrisk acceptanceを必要とします。保持期間と閲覧権限は組織規程で決め、production access自体も監査します。

## 必須の拒否条件

- 認可前の検索、cross-project join、全project一括Embedding
- audience不一致、issuer不一致、期限切れ、署名未検証token
- clientから渡されたfilesystem path、Git remote URL、index名の直接利用
- Toolからmainへの直接write、PRの自己承認・自動merge
- secret findingを含むproposalの無警告submit
- restricted Entryの既定返却
- raw database、SQLite index、vector indexのexport
- token、検索文、本文を含むapplication/audit log
- backup未検証状態でのproduction上書きrestore

## 仕様根拠

- [MCP Authorization specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [MCP Tools specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
- [RFC 9700: Best Current Practice for OAuth 2.0 Security](https://datatracker.ietf.org/doc/html/rfc9700)
- [RFC 9728: OAuth 2.0 Protected Resource Metadata](https://datatracker.ietf.org/doc/html/rfc9728)
- [RFC 8707: Resource Indicators for OAuth 2.0](https://datatracker.ietf.org/doc/html/rfc8707)
