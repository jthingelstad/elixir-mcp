# 2026-11-13 — The battle page's, Settings' and Clan's read budgets

The third and last of the signed-in page budgets (the first two are
`2026-11-13-player-page-and-stats-budgets.md` and
`2026-11-13-find-bell-search-budgets.md`). This one covers the battle
page, a shared post, Settings' reads, the timeline (`/api/me/timeline`,
which Settings' agent Timeline page shares through
`/api/agent/<id>/timeline`), the RSS feed, and Clan's pages past the
landing's budget: Manage, History, Run, Awards, Recruit, Sharing,
Voice, Social, the Map, your away note and a member's activity.
Standings, War and Policy are in `clan-landing-budget.test.mjs`.

## How it was measured

As the first two notes: `signed-in-seed.mjs` at 52 weeks and 20 clans
for the numbers below, each read through the web API's own handler in
page order, each statement run again under `EXPLAIN (ANALYZE, BUFFERS)`.
`signed-in-budget.test.mjs` pins every read below at 26 weeks and 8
clans: statement counts, no Seq Scan of a large table, a shared-buffer
ceiling per read, and the checks named below.

## Before and after

Shared buffers summed over a read's statements.

| Read | Statements | Before | After |
| --- | --- | --- | --- |
| `/api/me` (every page's shell) | 11 | 2,332 | 727 |
| `/api/me/verify` (Settings, Players) | 4 | 1,778 | 170 |
| `/api/me/timeline` (and an agent's Timeline) | 411 | 301,389 | 38,466 |
| `/api/rss/<token>` (the feed) | 408 | about 301,000, as the timeline | 37,079 |
| Clan `/map` | 69 to 21 | 1,646 | 1,602 |
| `/api/me/cheers?battle=` (fixed in #978) | 26 | 1,735 | 741 |
| `/api/public/battles/<id>` | 21 | 546 | 546 |
| `/api/public/highlights/<id>` (a post) | 22 | 544 | 544 |
| `/api/me/highlights?battle=` | 5 | 11 | 11 |
| `/api/me/follow-cost` | 5 | 194 | 194 |
| `/api/me/follow-slots` | 6 | 554 | 554 |
| `/api/me/first-answer` | 8 | 148 | 148 |
| `/api/me/clans` | 6 | 194 | 194 |
| Settings' other reads (usage, email, sends, sessions, activity, requests, connections, principals, feedback, RSS and Discord state) | 3 to 6 each | 0 to 14 each | the same |
| Seen: `battles_query`, one battle | 20 | 81 | 81 |
| Clan `/manage`, evaluated | 61 | 24,463 | the same |
| Clan `/manage`, cached | 13 | 205 | the same |
| Clan `/awards`, evaluated | 53 | 21,283 | the same |
| Clan `/awards`, cached | 14 | 206 | the same |
| Clan `/members/<tag>/activity` | 68 | 12,266 | the same |
| Clan `/history` | 25 | 1,604 | the same |
| Clan `/recruit` | 26 | 1,604 | the same |
| Clan `/run`, `/sharing`, `/voice`, `/social`, `/me/away` | 6 to 11 | about 200 each | the same |

## What changed

- **The observed late-capture count** (`prefetchStatements` in
  `packages/tools/src/activity/entries.mjs`) ran the per-player count
  once for every tag of a batch, and each one read the whole week's
  battles by `created_at`: 263,921 buffers for a feed of 56. It now reads
  the week's late captures once, looks up each one's players by the
  primary key, and counts them by player. An occurred window reads each
  player's own battles by time, so it stays per tag.
  `prefetch-plan.test.mjs` asserts each tag's count equals the old
  per-player statement's, the week read once by `battle_created_at`, and
  no scan of `battle` or `battle_participant`; the budget test asserts the
  timeline makes one such statement under a buffer ceiling.
- **The feed** (`GET /api/rss/*`) passes `lateCounts: false`: it serves
  items and never an entry's late-capture count (as the bell and cheers
  do since #978, whose test asserts the items are identical).
- **`/api/me` and `/api/me/verify`** read each claim's player through a
  `cross join lateral (... limit 1)`. Joined plainly, the planner
  merge-joined the claims against `player_pkey` and walked the index from
  the first claimed tag to the last. The test asserts `player_pkey` per
  claim, and runs each old join against the same record for the same
  rows.
- **Clan's Map** read each member's place by key, one statement apiece
  (52 on the full seed). The clan-state store has `getMany` (one
  statement, keys in order, absent ones left out) and `places` uses it.
  `clan-state/test/postgres.test.mjs` asserts `getMany` answers what one
  `get` per key answers; the budget test asserts the Map reads its places
  together.

Nothing a page shows, who can see it, or any tool's output changed.

## Left as it is

- **The timeline's per-subject reads**: about seven statements for each
  followed player and clan (name and clan, events, membership, two
  presence reads, a status read, `sittingAnchors` at about 340 buffers
  each). It is the shared timeline builder; a batch there is its own
  change.
- **Clan's participation evaluation** (Manage and Awards evaluated,
  shared with Standings): its weekly-count statement (about 10,200) and
  intervals statement (about 8,600) read the window by range, and look
  up each battle's side by key on purpose, to keep the index-only scans.
  Manage and Awards each evaluate when asked alone and cold; on the page
  they share the cache.
- **A member's activity** (12,266) is `packages/record/src/member-activity.mjs`,
  outside this change.
- The battle page and a post read the battle by key; pinned, not changed.
