# 2026-11-13 — The player page's and Stats' read budgets

Every signed-in page gets a statement count and a plan-shape budget, as
Clan's landing did (#950, #957). This change covers the player page (its
Timeline and Record tabs, your own, a clanmate's and a stranger's) and
Stats (Season, Cards and Decks, and the reads behind the season list).

## How it was measured

`services/web-api/test/signed-in-seed.mjs` builds a synthetic record: the
fixture clan's week through the ingest pipeline, then copied by SQL into
more weeks and more clans, a day row per member per day, the reader (King
Thing) following 55 players and followed by 20 accounts, and 40
highlights. At its defaults (52 weeks, 20 clans) that is about 118,000
battles, 237,000 participant rows, 35,000 players and 358,000 day rows;
the numbers below are from that size. Each read went through the web
API's own handler, one at a time in page order, and every read statement
was run again under `EXPLAIN (ANALYZE, BUFFERS)`.

`services/web-api/test/signed-in-budget.test.mjs` pins it at half that
size (26 weeks, 8 clans, about 55,000 battles; it seeds in a few
minutes): a statement count per read, no Seq Scan of `battle`,
`battle_participant`, `player`, `player_snapshot_daily`,
`player_daily_battle_rollup` or `battle_participant_round`, none read
past a quarter of its rows, a shared-buffer ceiling per read, and the
named index where a fix depends on one. Never milliseconds. Its last
test runs each fixed statement again in its old form against the same
record and asserts the same rows.

## Before and after

Shared buffers summed over a read's statements (statement counts did
not change unless shown).

| Read | Statements | Before | After |
| --- | --- | --- | --- |
| `/api/player`, your own | 29 | 21,154 | 4,720 |
| `/api/player`, a clanmate's | 26 | 3,230 | 3,233 |
| `/api/player`, a stranger's | 26 | 803 | 804 |
| `/api/me/cheers`, your own page | 26 | 1,728 | 1,722 |
| `/api/clan/me` | 15 | 1,814 | 207 |
| Record tab: `players_summary` | 28 | 3,947 | 3,509 |
| Stats: `battles_performance`, the season list (from the first recorded battle) | 18 | 18,195, Seq Scan of `battle` | 21,428, no Seq Scan |
| Stats: `battles_performance`, this season | 18 | 4,042, Seq Scan | 898 |
| Stats: `battles_performance`, this season, Trophy Road | 18 | 3,960, Seq Scan | 816 |
| Stats: `battles_performance`, by week | 18 | 3,581, Seq Scan | 437 |
| Stats: `elixir_coverage` | 16 | 3,126, Seq Scan | 150 |
| Stats: `battles_query` | 22 to 21 | 1,177 | 660 |
| Stats: `battles_decks`, this season | 22 | 6,510, Seq Scan | 580 |
| Stats: `battles_cards`, yours | 15 | 2,913 | 1,144 |
| Stats: `battles_cards`, your opponents' | 15 | 3,127 | 1,373 |
| `war_current` | 19 | 1,985 | 483 |

The season list grows with the reader's window, not with the battle
table: the old plan hashed every battle in the record (2,979 pages here,
far more in production), the new one reads the reader's 1,768 battles by
key.

## What changed

- **The player page's requests.** Its cheers (`/api/me/cheers`) and your
  clans (`/api/clan/me`) waited for `/api/player` to answer, though
  neither needs it. `PlayerPage` now asks for both beside the page read,
  under the same query keys, so the views share them. Two round trips
  on load become one.
- **Highlights** (`highlightItems`): each highlight's participant row by
  its primary key (a lateral, `limit 1`). Joined plainly, the planner read
  it off the player's whole history once per highlight.
- **Your players** (`myPlayers`, behind `/api/clan/me` and others) and
  **the race's names** (`war_current`): each player's row by key. A plain
  join merge-joined against `player_pkey` and walked it end to end.
- **Boat defenses in every `battles_*` window** (`ownBattlesClause`):
  `notBoatDefense` with its keyed lookup, which already existed for wide
  reads. The EXISTS form hashed every boat battle in the record.
- **Duels** (`duelSql`, MCP contracts): the round rows probed by key per
  row instead of an EXISTS the planner hashed over the whole round table.
  Migration 0265 adds `battle_participant_round_player (player_tag,
  battle_id)`: Stats' Cards tab reads a player's rounds, and the table had
  only its key led by the battle.
- **`battles_performance`** and **`battles_cards`**: each row's battle by
  key; the plain join let the planner hash the battle table.
- **The ladder floor** (`controls.mjs`): the last battle's arena is read
  for the one last battle, not joined for every battle of the window.
- **`elixir_coverage`**: the appearance count reads the participant row's
  own `battle_time` (0014), with no join to `battle`.
- **`players_summary`**'s deck reads: "a deck the player chose" is a keyed
  lookup of the battle, not an EXISTS the planner could hash.

No output changes, no MCP contract change, no change to who sees what.

## Left as they are

- `/api/me/cheers`' late-capture count reads every battle created in the
  window's week (1,031 of its 1,722 buffers here): it grows with the whole
  corpus's week, not the reader's. A keyed form reads the reader's whole
  history instead, which is worse; the fix is an index on `battle
  (created_at) include (battle_time)`, a large table's index for one
  count, not taken here.
- `players_summary`'s two deck aggregates (1,311 and 964 buffers) and the
  player page's sittings read (1,471) are probes of the reader's last 30
  days, bounded by the window.
- Stats' season list is one `battles_performance` read from the first
  recorded battle, for the season names in its applied window. A cheaper
  read for those names would be a new tool argument (a contract change),
  so it stays.
