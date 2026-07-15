# Changelog

## 0.0.1 - Unreleased

- Add clipboard and selection-based knowledge registration
- Add offline template and VS Code Language Model generation
- Add secret-like value warnings before model submission and local save
- Add weighted Markdown search
- Add `#totonoeKnowledgeSave` and `#totonoeKnowledgeSearch` tools
- Add unit tests, GitHub Actions, security documentation, and dogfooding guidance
- Add Extension Host integration tests without consuming a Language Model Provider
- Add repository validation for metadata, duplicate IDs, and broken relationships
- Add optional related, supersedes, and source-reference metadata to the Save Tool
- Add 14-day GitHub Actions VSIX artifacts for pre-alpha dogfooding
- Add a rebuildable SQLite FTS index with incremental Markdown synchronization
- Preserve Japanese and substring search through derived n-gram tokens and weighted reranking
- Fall back to direct Markdown search when the disposable index is unavailable
- Retry only transient VS Code test-runtime downloads while preserving Extension Host test failures
- Add direct AI/template registration commands with clearer user-facing descriptions
- Reuse the previously selected AI model and remove redundant AI metadata prompts
- Preselect the type/ID/title-derived local save path so a reviewed draft saves with `Ctrl+S`
- Add an explicitly confirmed external repository picker shared by registration, search, validation, and Agent tools
- Keep external repository URIs machine-local, fail closed when unavailable, and ignore non-knowledge root Markdown
- Preserve discovery of legacy root Markdown entries that contain a `K-` knowledge ID
- Add inclusive applicability bounds and target-version search with transitive `supersedes` filtering
- Validate malformed, incompatible, and reversed version ranges without requiring legacy entry migration
- Show explicit applicability and replacement relationships in Save Tool confirmation
- Define the OAuth, project ACL, MCP output, and audit boundaries for a future remote repository
- Add a readable Markdown export and fail-closed backup/restore runbook
