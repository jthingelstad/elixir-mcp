# 2026-11-13 — Clan's Feed reads the clan, and starts at once

The owner, 2026-11-13: Home is snappy, "the Clan page however is
incredibly slow". Clan's landing (`/clan/<tag>/feed`) was measured on a
seeded scratch database (`services/web-api/test/clan-landing-seed.mjs`:
the fixture roster of 49, twelve weeks of battle logs each through the
ingest pipeline, other clans' battles beside them so the clan's rows are
a small part of each table, half of those learned this week as late
captures, as history backfills are).

## What the landing asked for

The page asks `GET /api/clan/me` first (the layout, 15 statements), then
together the roster (16), the race (21), Actions (37 cold, 11 warm), You
here (`/me`, 49), This week (`/week`, 41 to 67) and Home's follow plan
(9). The timeline (`/feed`, 30) waited for four of them (G3, 2026-11-12):
three round trips before the page's last read started.

| read | before | after |
| --- | --- | --- |
| `/feed`, warm | 905 ms, 880 ms in the database | 180 ms, 148 ms in the database |
| the late-capture statement | 750 ms, 343,000 buffers, a Seq Scan of `battle` | not run |

Every other landing read was under 100 ms locally. Times are supporting
evidence only; the tests hold counts and plans.

## Causes, by cost

1. **The Feed paid for a count it never shows.** `readClanFeed` built the
   clan's timeline with the late-capture count on. That count walks every
   battle the record learned in the week, for every clan, and probes each
   one's participants for this clan: its cost grows with the whole record,
   not the clan, and cold it is reads all over `battle_participant` (the
   same statement was 3.5 s cold in `elixir_timeline#1`, note
   2026-11-12-clan-late-counts-only-when-said). The Feed draws items only,
   never a clan entry's activity counts, so it now passes
   `lateCounts: false`. The items are the same (tested).
2. **The wait.** With the timeline in the same cost class as the panels,
   the Feed asks for every read at once.
3. **Joins the planner could turn into whole-table scans.** Three
   timeline and week statements joined `battle` or `player` for a clan's
   few rows, and on the seeded tables planned a Seq Scan of the whole
   table (live, `clan.member_battles` read `battle` by a parallel
   sequential scan, note 2026-11-12): `clanMemberBattlesQuery` and
   `clanMostQuery` now read each row's battle by key in a `LIMIT 1`
   lateral (off `battle_timeline_cover`, 0249), the week's member names
   (`clanWeekBattles`) and the donation leader are a primary-key scalar
   each. Rows unchanged.

## Held by tests

`services/web-api/test/clan-landing-budget.test.mjs` runs every read the
Feed page makes on load, and the first reads of Standings, War and
Policy, through the web API's handler over the seeded clan, and holds:

- each read's statement count to a ceiling (`BUDGET`), to come down,
- no Seq Scan of `battle`, `battle_participant`, `player`,
  `player_snapshot_daily` or `player_daily_battle_rollup` in any
  statement's plan, and no scan of one reading past a quarter of its rows,
- the Feed never running the late-capture count, and its items equal the
  full read's.

## Not changed

- Each request still runs the clan gate and identity (about 10 to 15
  statements), and `/me`, `/actions` and `/week` each evaluate the clan's
  participation (shared only while one is in flight). Locally each is
  tens of milliseconds; a stored per-clan evaluation is the next step if
  production says otherwise.
- `MEMBERS_SQL` (the participation "members" list) plans as one index
  probe per member here (49 members, 2.8 ms); its production cost is
  cold reads, not its shape.

No contract, API or migration change.
