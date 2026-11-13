# 2026-11-13 — clan_state_import is dropped (0263), with Clan's import code

Clan moved its private state into Postgres once (0196), from its store as
a separate app, and `clan_state_import` held that import's receipt: a
digest and counts, no bodies, no tokens. 0256 kept the table for the
retirement of Clan's old family OAuth client, which stopped reading it in
#968. Clan is part of Elixir, not an app with a store of its own (Jamie,
2026-11-12), so the last of that import goes:

- **0263** drops `clan_state_import`. The table had one row, and only
  this import wrote to it.
- `packages/clan-state/src/import.mjs` (`inspectSnapshot`,
  `importSnapshot`, `compareSnapshot`) and its `./import` export are
  removed. Nothing ran them.
- The import's two tests in `packages/clan-state/test/postgres.test.mjs`
  are removed, and so are its retention registry entry and its line in
  `packages/clan-state/AGENTS.md`.

The guard is `docs/no-clan-product.test.mjs`. It fails when any tracked
file outside dated history names the table, `importSnapshot`, or
`@elixir-mcp/clan-state/import`. The schema fingerprint pins the table's
absence.

**Before deploying, snapshot the database:** the drop cannot be undone.
After the snapshot, a deploy applies 0263. A previous build's
`{family_clients: {retire_app}}` with apply would fail once the table is
gone, so that op runs on this build or later.

No behaviour, MCP contract or JSON API change.
