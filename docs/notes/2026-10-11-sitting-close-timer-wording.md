# 2026-10-11 — The sitting-close timer's line says what its wake does

Codex on #517: the five-minute wake runs the account's ordinary
`syncAccount` (`packages/syndication/src/sync.mjs`). It therefore also
posts news a delayed or failed admission left past `synced_to`, as the
closing-run test in `packages/syndication/test/sync.test.mjs` shows. The
DECISIONS line said the timer "never posts". It now says the wake is the
ordinary sync and the timer starts no story of its own. Behaviour is
unchanged.

Docs only. MCP and JSON API unchanged, no migration.
