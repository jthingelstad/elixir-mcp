# 2026-11-13 — Clan's links use the shared Link; test clients end in a finally

Two refactor misses, each finished with a guard against the old shape
(Jamie, 2026-11-13).

**Clan's links.** Thirty-five links in Clan's views still handled their own
clicks: an `<a href onClick>` that called `preventDefault()` and then
`navigate`, or a `Panel as="a"` with a hand-rolled `go(...)`. Each is now
the shared `Link` from `@elixir-mcp/ui` with the same `to`, markup and
classes. `Link` takes over only an unmodified primary click, so
Cmd-click, Ctrl-click and middle-click now open a new tab on every one of
them, as they do everywhere else in Elixir. The dead `go`, `toModel` and
`toModelVoice` helpers are gone. Files: `ActionCard`, `SpreadWord`,
`YouHereCard`, and the views `Actions`, `ActivityDiscordSetting`,
`Awards`, `Clan`, `ClanPolicy`, `Manage`, `MemberActivity`, `Members`,
`Recruit`, `Run`, `Season`, `Standing`, `Waiting`, `YouHere`.

Guard: `apps/web/test/clan/links.test.jsx` fails when any view under
`apps/web/src/clan/` puts `onClick` on an `<a>` (a balanced-brace scan,
so an arrow handler with template literals is still inside the tag) or
draws a component `as="a"`. Run against the old code, it finds all 35.

**Test clients.** Twenty-three tests opened a Postgres client, did their
work and called `end()` with no `finally`, so a failing assertion leaked
the connection and held a client slot for the rest of the suite. Each now
ends in a `finally`: `migrate`, `vacuum`, `retired-schema`,
`reference-seed-preview`, `primary-clan-follow-backfill`,
`membership-first-read-baseline`, `ops-collectors` and `ops-profile` in
`services/migrate/test`, plus the ledger's concurrent settle and the
deck-form identity test.

Guard: `docs/test-clients-end.test.mjs` fails when a test's own
`new pg.Client` is ended at the same depth as its `connect()` after
other work. Pool leases in `packages/http/test/database.test.mjs` are
left alone: ending a lease mid-test is the behaviour that file tests.

No behaviour change beyond the new-tab clicks; no MCP contract or JSON
API change.
