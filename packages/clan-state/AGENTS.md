# clan-state

Elixir Clan's private management ledger: policy versions, verdict
snapshots, Actions, decisions, holds, notes, awards and sealed model keys,
as items of one clan in `clan_state` (migration 0196). Read
`packages/clan/AGENTS.md` first; the item kinds are listed at the top of
`src/ledger.mjs`.

- The Postgres adapter (`src/postgres.mjs`) takes the request's existing
  connected client; the caller owns transactions and the serialization of
  multi-item changes.
- This state is private: nothing here is imported by MCP, the tools or any
  public game package.
- A policy version is immutable; a change is a new version.
- `src/import.mjs` is the one-time digest-bound import from Clan's former
  store, kept with its test; nothing runs it.
