# Keep the Boards

Own the outcome: **the leaderboards are recorded as promised, and the
collections drawn from them say something true.** The global Path of
Legends board lands every hour and every location every day; a top-200
appearance records the player for the season; the board-driven collections
(`pol-global-top-100`, `pol-us-top-100`, `pol-jp-top-100`,
`global-top-10-clans`) equal today's board; and at a season boundary the
record behaves the way `docs/recording.md` says it does.

This owner exists because a leaderboard is the one record whose gap is
invisible: nothing errors when an hourly snapshot does not arrive, the
board just has a hole in it, and the season-story video that hole ruins
is not made until the season is over.

## Every run

Establish, with receipts:

- **The snapshots arrived.** For the global `pol` board: a
  `ranking_snapshot` observed within the last two hours, and no gap longer
  than three hours in the last 24 (`last_confirmed_at` counts — an
  unchanged board confirmed on the hour is a fetch that happened). For the
  262 location boards: every enabled board observed or confirmed within
  the last 36 hours. Read through `rankings_players` (`snapshot.observed_at`,
  `snapshot.unchanged_until`) or the migrate lambda's `{stats: true}`;
  never a hand SQL against production.
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

- A missed hourly snapshot: find whether the scheduler planned it
  (`poll_state` for `rankings_pol`/`global`), a collector leased it, or
  ingest rejected it — the same three places every other missed fetch
  hides in. Fix at the seam. A board that was not planned is a Run Elixir
  MCP pipeline question first; coordinate rather than duplicate.
- A `skipped: collapsed` outside a season boundary is a real board
  collapse or an API stub; read the raw payload in the archive before
  deciding which.
- Adding a board is a row in `ranking_board` (enable it, set its cadence)
  and, if a collection should mirror it, a line in `clients/boards/BOARDS`
  plus the collection created by hand in the console. Retiring one is the
  reverse. Every added board is fetches, and every recording board is up
  to N more recorded players — say the cost in the note.
- Deploys are part of this objective when a fix needs one:
  `AWS_PROFILE=jamie node infra/scripts/deploy.mjs`.

## Not this owner's

The meaning of a rank or a rating (Keep the Record True); whether the
rankings tools are pleasant to call (Close the Loop); whether recording the
whole field is a fair use of one key's budget (Guard the Door — this owner
reports the number, never argues it).

## Success

Every board has today's snapshot and yesterday's, the global board has all
of today's hours, the four collections match the record, and the run can
say what the leaderboard did since the last run in one sentence — "the top
100 turned over 24 players, the summit did not move." A healthy no-op ends
with that sentence in the notes and no commits.
