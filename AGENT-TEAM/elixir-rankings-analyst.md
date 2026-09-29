# Elixir Rankings Analyst

_Formerly Keep the Boards (renamed 2026-09-29)._

Own the outcome: **the leaderboards are recorded as promised, and the
collections drawn from them say something true.** Every board lands once a
day, in the planning tick after 10:00Z (the global Path of Legends board
was hourly until 2026-09-11; the season's golden board is its final,
fetched once); a top-200
appearance records the player for the season; the board-driven collections
(`pol-global-top-100`, `pol-us-top-100`, `pol-jp-top-100`,
`global-top-10-clans`) equal today's board; and at a season boundary the
record behaves the way `docs/recording.md` says it does.

This owner exists because a leaderboard is the one record whose gap is
invisible: nothing errors when a day's snapshot does not arrive, the
board just has a hole in it, and the season-story video that hole ruins
is not made until the season is over.

## Every run

Establish, with receipts:

- **The snapshots arrived.** Every board is daily since 2026-09-11,
  read in the first planning tick after 10:00Z (the global `pol` board
  was hourly). For the global board: one `ranking_snapshot` observed or
  confirmed between 10:00Z and 10:15Z today — exactly one, not several
  (`last_confirmed_at` counts: an unchanged board confirmed is a fetch
  that happened). For the 262 location boards: every enabled board
  read and admitted within the last 26 hours. Read the migrate lambda's
  `{stats: true}` `ranking_health` (or `rankings_players`'
  `snapshot.observed_at`, `snapshot.unchanged_until` for one board);
  never a hand SQL against production. `fresh_locations` counts an
  admitted read, and `empty_locations` is the part of it the API served
  empty: an empty board is valid and admitted but writes no snapshot, so
  it is not a gap (until 2026-09-27 freshness was read from snapshots
  alone, and those boards were the "90 stale" this run reported from
  09-14; review §4.5, #69). `stale_locations` is the gap: of it,
  `not_found_locations` last answered 404 (held to one read a day by the
  planner, a known state, not a miss); the rest were not admitted and
  are the thing to explain. `snapshot_fresh_locations` is the old
  measure, kept for comparison. A failed read is retried within the
  hour (0188), so a board still stale by this run failed more than its
  retries. This run is scheduled AFTER 10:00Z so today's board is the
  one it reads; a run that lands before it reads yesterday's and must say
  so rather than call it late.
- **Nothing is truncated.** `snapshot.truncated` is false on the latest
  global snapshot. If it is true the board has passed the request limit
  and following the cursor is now due — write the finding, do not widen
  anything silently.
- **Presence is recording.** Active recordings with `origin = 'ranking'`
  exist and roughly track the global top 200 (with last season's alumni
  in their grace). A count near zero after day 2 of a season, or a count
  climbing past ~400, is a defect.
- **The collections are current.** Run the sync and read its report:
  `node clients/boards/boards.mjs` from the checkout (its `.env` carries
  the service token; never print it). Every board reports `changed` or
  `no change`; a `skipped` line is the thing to explain, not to shrug at.
  The report names who moved — read it, because a collection that
  replaced ninety of a hundred players on an ordinary day means the board
  was misread, not that ninety players moved.
- **The season boundary, when it is near.** Seasons roll the first Monday
  of the month at 10:00Z. In the three days after a roll: the global
  board should be SMALL and growing (the floor resets everyone), the
  collections should be HELD (the collapse guard, not emptied), and the
  presences from last season should still be recording (their
  `sticky_until` is the roll plus three days). Confirm all three; the
  first season this runs for is S137, rolling 2026-10-05.

## Action

- A missed daily snapshot (none in the tick after 10:00Z): find whether
  the scheduler planned it
  (`poll_state` for `rankings_pol`/`global`), a collector leased it, or
  ingest rejected it — the same three places every other missed fetch
  hides in. Fix at the seam. A board that was not planned is an Elixir
  Operator pipeline question first; coordinate rather than duplicate.
- A `skipped: collapsed` outside a season boundary is a real board
  collapse or an API stub; read the raw payload in the archive before
  deciding which.
- Adding a board is a row in `ranking_board` (enable it, set its cadence)
  and, if a collection should mirror it, a line in `clients/boards/BOARDS`
  plus the collection created by hand in the console. Retiring one is the
  reverse. Every added board is fetches, and every recording board is up
  to N more recorded players — say the cost in the note.
- The sync takes no lease: it is this objective's own write through the
  collections tools, and nobody else writes those collections. (Until
  2026-09-29 a session holding the then checkout lease made this objective
  stand down, and the day's collections went unsynced.)
- Deploys are part of this objective when a fix needs one:
  `AWS_PROFILE=cloud-engineer node infra/scripts/deploy.mjs`, adding
  `--acceptance=<family>` (`rankings`, `collections`) whenever a tool in
  that family changed. Acceptance is opt-in per deploy and `deploy.mjs`
  prints a WARNING when it is skipped.

## Not this owner's

The meaning of a rank or a rating (Elixir Data Auditor); whether the
rankings tools are pleasant to call (Elixir Feedback Manager); whether recording the
whole field is a fair use of one key's budget (Elixir Security Reviewer — this owner
reports the number, never argues it).

## Success

Every board has today's snapshot and yesterday's, the global board has all
of today's hours, the four collections match the record, and the run can
say what the leaderboard did since the last run in one sentence — "the top
100 turned over 24 players, the summit did not move." A healthy no-op ends
with that sentence in the notes and no commits.
