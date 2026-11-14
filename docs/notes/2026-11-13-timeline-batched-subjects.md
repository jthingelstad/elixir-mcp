# 2026-11-13 — The timeline reads its players once, whatever their number

A follow-up to the signed-in page budgets
(`2026-11-13-battle-post-settings-clan-budgets.md`), which left the
shared timeline builder reading about seven statements for each followed
player, and to `2026-11-13-find-bell-search-budgets.md`, which left
Home's own week counting late captures it never shows.

## How it was measured

As the budget notes: `signed-in-seed.mjs` at 52 weeks and 20 clans (King
Thing following 55 players), each read through the web API's own handler,
each statement run again under `EXPLAIN (ANALYZE, BUFFERS)`.
`signed-in-budget.test.mjs` pins it at 26 weeks and 8 clans.

## Before and after

| Read | Statements | Shared buffers |
| --- | --- | --- |
| `/api/me/timeline` (and an agent's Timeline) | 411 to 26 | 38,413 to 38,247 |
| `/api/rss/<token>` | 408 to under 30 | about the same as the timeline |
| `/api/me/home/feed`, Home's week built | 417 to 31 | 38,406 to 37,280 |

The statement count no longer depends on how many players a timeline
follows: four players and fifty-six make the same statements, give or
take the reads a batch makes only when some player has rows for them (a
crossing to hydrate, an arena to name).

## What changed

- **`prefetchPlayers`** (`packages/tools/src/activity/entries.mjs`), the
  batch a timeline of two players or more already used for battles and
  profiles (G1), now also reads who each player is, the window's ledger
  rows, their clan moves, and the three presence reads, each once for
  every tag. Each is the per-player statement run per tag inside one
  statement (`perTag`: `unnest($1::text[]) with ordinality` and a
  `cross join lateral (... offset 0)`), so every player keeps its own
  index range; the last-battle-before-the-window read takes each tag's
  instant beside it (`unnest($1::text[], $2::bigint[])`). No
  `player_tag = any(...)` over per-player ranges. The reads keyed by a
  row's own id (ledger hydration, the moments' first ids, arena names)
  and the sittings' anchors take every player's rows in one statement, as
  they took one player's. `buildPlayerEntry` takes each from the batch
  when it has one, and reads alone as before when it does not.
- **`buildHomeWeek`** passes `lateCounts: false`: Home stores and serves
  items, never an entry, so its week no longer reads the week's late
  captures (968 buffers here), as the bell's week, cheers and the feed
  already do.

`signed-in-budget.test.mjs` asserts:

- the timeline and the feed in 30 statements (411 and 408 before), Home's
  built week in 36 and never the late count;
- a timeline of all the reader's players makes at most three statements
  more than one of four;
- a batched timeline equals the one each subject read alone makes
  (`batchPlayers: false`), deep-equal, observed and occurred, over a day
  and a week, with a clan among the subjects;
- the bell's, cheers' and Home's items (Home's subjects, in its time
  zone) are identical with and without late counts.

Nothing a page shows, who can see it, or any tool's output changed. No
contract change, no migration.

## Left as it is

- **The buffers.** The statements fell from 411 to 26 but the work did
  not: about 19,000 buffers are the sittings' anchors (the walk back to
  each sitting's first battle and its battle count) and about 16,000 the
  window's battles with each battle's row and the other side's crowns.
  Both read only the followed players' own week, by their own ranges.
- **Clan subjects.** A followed clan's entry is its own builder
  (`buildClanEntry`), about 16 to 18 statements a clan. A follow list
  holds few clans; batching that builder is a change of its own.
