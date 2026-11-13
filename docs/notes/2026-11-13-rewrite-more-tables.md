# 2026-11-13 — {rewrite_table} reaches the purged tables

The 2026-10-07 purge left about 400 MB of dead space that autovacuum
cannot return: only VACUUM FULL gives a file back. `{rewrite_table}`
named only the three tables 0097's dropped column had bloated
(`battle_participant`, `battle_participant_card`, `deck_card`), so they
were the only ones rewritten. The 2026-11-13 storage census still showed
the purge's row sizes: `player_snapshot_daily` 105 MB for 20,557 rows,
`player_badge` 55 MB for 16,340, `battle` 175 MB for 105,214, `deck`
109 MB for 109,241, `player_daily_battle_rollup` 73 MB for 134,280,
`player` 54 MB and `api_receipt` 341 MB.

The op's closed list now also names `battle`, `battle_participant_round`,
`deck`, `player`, `player_snapshot_daily`, `player_daily_battle_rollup`,
`player_badge`, `api_receipt`, `mcp_call_audit`, `capture_audit` and
`job`. It is still a closed list: the name enters SQL, now quoted.

The op had no timeouts, so a rewrite past the Lambda's 300 s would have
kept its ACCESS EXCLUSIVE lock after the Lambda died. It now sets a
240 s statement timeout and a 10 s lock timeout (`REWRITE_TIMEOUTS`), and
a rewrite that cannot run answers `rewrite_failed` with its SQLSTATE and
leaves the table as it was. Each answer reports total, heap and index
bytes and the row estimate before and after, and `freed_bytes`.
`services/migrate/test/ops-rewrite.test.mjs` pins the list, the sizes
and both timeouts on a scratch database.

Running it stays Jamie's window (the bounds and order are in
`docs/OPERATIONS.md`, Incident authority). No migration, no contract
change, nothing user-visible.
