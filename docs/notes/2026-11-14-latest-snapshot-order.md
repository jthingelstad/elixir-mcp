# 2026-11-14 — A player's latest snapshot is the newest observation (#512)

`player_snapshot_daily` keeps up to three rows per player and game day:
`daily`, which every observation moves, and the auxiliary `pre_reset` and
`season_roll` rows, written only inside their windows and frozen after.
Every "latest snapshot" read ordered `snapshot_date desc, snapshot_kind
desc`, so on a game day that held the weekly donation window the frozen
`pre_reset` row won on its name. From Monday 00:10Z, when the window
closes, to the 10:00Z game-day turn, those reads served the values of the
window's last read: trophies, donations, the lifetime block, the clan
rank. `packages/tools/test/live.test.mjs` failed in that window for this
reason; it was right and stays as it is.

What changed:

- **One order** in `@elixir-mcp/record/latest-snapshot`:
  `latestSnapshotOrder({ alias, stamp })` is `snapshot_date desc, <stamp>
  desc nulls last, snapshot_kind = 'daily' desc`. The stamp is the row's
  own observation time: `observed_at` for any row, `profile_observed_at`
  for the profile block, `roster_observed_at` for the roster columns. A
  row's date is the game day of its observations, so the order is the
  stamp's, while the leading date lets the primary key serve the read (a
  backward probe to the newest day, then a sort of its two or three
  rows). On a tie (one read inside the window writes both rows at one
  instant) `daily` wins: `pre_reset` keeps the week's donation high-water
  mark, and the latest read wants the counter as it stands.
- **Every reader uses it**: `readRecordedProfile` (players_profile and the
  syndication dossiers), the profile baseline in ingest
  (`snapshots.mjs`), `players_summary`, `players_collection`,
  `players_search`, `clans_roster` (three reads), `battles_compare`,
  `clans_series`' carried profile (it had ordered by date alone, so the
  row it took on a window day was the planner's choice), the timeline's
  snapshot at an instant (a tie-break only), the two syndication
  laterals, and the web app's Home and player-page trophies.
  `packages/record/test/latest-snapshot.test.mjs` fails on any source file
  that orders snapshots by kind name or spells its own date-then-stamp
  order.
- **Tests on real ingest**: `packages/tools/test/latest-snapshot.test.mjs`
  writes a roster and profiles at Monday 00:05Z (daily and pre_reset) and
  again at 00:20Z (daily only, the same game day), and every tool above
  answers from 00:20Z; on the old order five of its seven tests fail. The
  Home and player-page route tests carry a `pre_reset` row observed an
  hour before the day's `daily` row. `live.test.mjs` passes with the
  process and database clocks set to Sunday 23:20Z and Monday 00:05Z,
  00:15Z and 09:50Z.

No index was added: every read still starts on the primary key's
`(player_tag, snapshot_date)` prefix, as before, and the query-budget
tests are unchanged. The kind-keyed series reads (a series that asks for
`pre_reset` rows) name their kind and do not use the helper.

MCP 13.2.2 (a correction). JSON API 5.1.0 unchanged. No migration.
