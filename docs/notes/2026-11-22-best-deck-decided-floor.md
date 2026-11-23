# 2026-11-22 — best_deck's floor is ten decided battles

Codex's review of #1187 (one win rate on every surface) found that
`players_summary`'s `best_deck` still qualified a deck on ten battles of
any kind with at least one decided. A deck with nine boat attacks and one
head-to-head win passed the floor and ranked at 100% on a record of one,
ahead of a deck with a real decided record. The 15.5.0 changelog already
said "best_deck's floor counts decided battles"; the query did not.

The floor is now ten decided battles (`decidedWinsSql` plus
`decidedLossesSql` at least 10), the number the floor always had, counted
the way the rate is. The tool's note says so. A test seeds the case Codex
described and holds `best_deck` to the deck with ten decided battles
(`packages/tools/test/war-tools.test.mjs`).

The earlier note (`2026-11-22-win-rate-one-definition.md`) says the floor
is "five decided battles". That was wrong when written: no five was ever
in the code. Ten is the floor.

Ships inside MCP 15.5.0, which had not reached production when this
merged, so there is no bump of its own. JSON API 6.0.0. No migration.
