# 2026-11-17 — First win: two review fixes (#1116)

Two Codex findings on `card_first_win` (#1116), both fixed in
`packages/ingest/src/card-first-win.mjs`, each with a test that fails
without its fix (`packages/ingest/test/card-first-win.test.mjs`).

- **The read before the unlock, on the same game day.** The search for
  the first win starts at the profile read before the unlock, taken from
  `player_snapshot_daily`. That table keeps one row a game day, so when
  both reads fell on one day the earlier read's time was overwritten by
  the unlock read's, no earlier row was found, and a win between the two
  reads was skipped (a later win could then be called the first). With
  no earlier day's row, the search now starts at the game day's start
  (10:00Z): the read before was no earlier, and the card was not held
  at it, so no win with it is older.
- **A first win the record already held.** From a battle-log read, the
  first win must be one that read delivered (after its mark). A first
  win recorded before the rule shipped now keeps later wins silent, as
  the rule says, instead of being told late.

No contract change: the item's shape and promise are as 13.9.0 says.
