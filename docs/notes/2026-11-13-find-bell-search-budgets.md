# 2026-11-13 — Find's, the bell's and the search sheet's read budgets

The second of the signed-in page budgets (the first, the player page and
Stats, is `2026-11-13-player-page-and-stats-budgets.md`). This one covers
Find (Suggested, From your battles, Your clan with its follow plan, the
slots), the bell (built and stored), Home's needs and clan reads, and the
search sheet (a player's tag, a clan's tag, a name).

## How it was measured

The same seed and method as the first note: `signed-in-seed.mjs` at 52
weeks and 20 clans for the numbers below, each read through the web
API's own handler in page order, each statement run again under
`EXPLAIN (ANALYZE, BUFFERS)`. `signed-in-budget.test.mjs` pins the new
reads at 26 weeks and 8 clans: statement counts, no Seq Scan of a large
table, a shared-buffer ceiling per read, and the checks named below.

## Before and after

Shared buffers summed over a read's statements.

| Read | Statements | Before | After |
| --- | --- | --- | --- |
| `/api/me/bell`, built (the week's first read) | 35 to 34 | 2,008 | 979 |
| `/api/me/bell`, stored | 13 | 279 | 281 |
| `/api/me/cheers`, your own player page | 25 | 1,722 | 691 |
| `/api/me/people/battles` (From your battles) | 8 | 13,314, Seq Scan of `battle_participant` | 1,097 |
| `/api/me/people/suggested` | 10 | 12,805, Seq Scan of `battle_participant` | 471 |
| `players_search`, "Invented" (nearly every player matches) | 6 | 178,991 | 426 |
| `players_search`, "King" (few match) | 6 | 381 | 379 |
| `/api/me/home/needs` | 12 | 217 | 217 |
| `/api/me/people/clan` | 11 | 519 | 519 |
| `/api/me/follow-plan` | 9 | 362 | 362 |
| `/api/me/follow-slots` | 6 | 557 | 557 |
| `/api/me/clans` | 6 | 194 | 194 |
| `/api/me/home/clan` | 9 | 204 | 204 |
| search: `players_summary`, a stranger | 28 | 998 | 998 |
| search: `clans_roster`, your clan | 14 | 1,402 | 1,402 |

The two Find tabs had regressed on `main` earlier the same day, when
`metInBattles` began reading the other side of each battle: the planner
hash-joined `battle_participant` whole instead of probing it per battle.

## What changed

- **`metInBattles`** (`services/web-api/src/people.mjs`) reads each
  battle's other side through a `cross join lateral (... offset 0)`, so
  every probe is by `battle_id`. The test asserts that read uses the
  primary key or the player-time cover.
- **The late-capture count** (`playerBattles` in
  `packages/tools/src/activity/entries.mjs`) counted every battle the
  record learned in the week, anyone's: about half the built bell's
  buffers. `buildTimeline` takes `lateCounts` (default true); the bell's
  week and cheers pass false, since they serve items and never an entry's
  `battles.late_captures`. A test builds the same timelines both ways and
  asserts identical items and identical entries but for that count, and
  the bell's test asserts the count's statement never runs.
- **`players_search`** probed each match's clan, trophies and source
  (claim, clanmate) for every matching player before sorting and cutting
  to the limit. It now works out the reader's own players and clanmates
  once (two small materialized sets), ranks and counts the matches, cuts
  to the limit, and reads clan and trophies for the rows shown only. A
  test runs the old statement against the same record for four queries
  (with a nickname added so every source occurs) and asserts the same
  matches, the same ranking and the same first rows.

Nothing a page shows, who can see it, or any tool's output changed.

## Left as it is

- `players_search` still reads `player` whole by name: the match is a
  substring (`ilike '%q%'`), which only a `pg_trgm` GIN index serves.
  That is an index and an extension in production; size `player` there
  first.
- `clans_roster` (1,402) reads per member, keyed; pinned, not changed.
- The search sheet's fallbacks (summary, then roster, then search) and
  Find's follow plan after Your clan (it needs the clan's tag) are
  dependencies, not waterfalls.
- Home's own week (`buildHomeWeek`) could pass `lateCounts: false` too;
  it is outside this change's pages.
