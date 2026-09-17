# Time-series capture at the data layer

Written 2026-09-17 (evening) against the brief for the 2026-09-18 session.
Assessment only; nothing here has been applied. Execution is a separate
session, one phase at a time, gated by Jamie. The six decisions Jamie made
on 2026-09-17 (the game day, day grain, history import as validation,
poapkings.com onto Elixir, the metric set, multi-clan by construction) are
applied throughout and not reopened.

Revised the same evening after Jamie's read: the member series is no
longer its own table but the player's own snapshot row written by the
roster (the roster is a partial profile read of fifty players), the
polling-rate question is left to the adaptive-polling work, and the
decisions that need Jamie are collected up front. Parts 1 to 8 and the
appendices are the evidence; **"Read this first"** is the part to read.

## Read this first: the principle, and the four decisions

**The principle.** A pull feeds every subject it describes, not only the
one it was made for. The recorder already does this in places (a battle
log names opponents and their clans and lands them on `player`; a roster
stamps `player.game_last_seen_at`; a board seeds player and clan rows).
It does not do it where it matters most: a roster poll is a partial
profile read of up to fifty players, made up to 96 times a day, and the
players' trophies, donations, arena and last-seen in it are thrown away
while the same players' profiles are polled separately for the same
numbers. This review makes the roster write the players' own daily
snapshot rows, the race poll write the rivals' clan rows, and the war log
write the attendance day the live poll missed, and it proposes the
standing rule (2.7) that makes every dropped field a recorded decision.
What it does **not** propose is a change to how often anything is
polled: the roster carrying the profile's fast-moving fields is an input
to the adaptive-polling work on the play-time histogram (NOTES
2026-09-13, "Adaptive polling, step one"), and the cadence decision
belongs there.

**The decisions.** Three were taken by Jamie on 2026-09-17 after the
first draft; one is open. Everything else follows the six decisions of
2026-09-17 and needs a go per phase, not a judgment.

1. **`player_snapshot_daily` moves to the game day** (3.2). Decided:
   move it, in Phase 1, before anything else writes to it. Jamie: "we get
   everything on a consistent game day; that will make navigating data
   much easier through the whole corpus." ~16k rows, ten readers that
   need no change; a read-only census op reports exactly which rows move
   before the op runs.
2. **Every member of every polled clan gets a roster-written row** (4.2).
   Decided. Jamie: "our whole goal with Elixir is to build a
   comprehensive record of Clash Royale, and we already have that data."
   ~24,800 rows a day, ~2.3 GB a year, the second-largest growth in the
   database after the battle participants; the backfill writes the rows
   for every clan the archive holds a roster for.
3. **The progress zero-bucket rule** (4.3). Decided: a side-mode bucket
   reading `trophies 0, bestTrophies 0` writes no row. Jamie: "no record
   for no activity." ~140 MB a year instead of ~410 MB.
4. **Open: the standing rule as an invariant** (2.7). Today a field the
   API adds is noticed by the next review (`kingTowerLevel` appeared on
   2026-09-02 and was found here), and a field deliberately dropped has
   its reason in a NOTES entry or nowhere. The proposal is three
   mechanical parts: each projector keeps a list of every field its
   endpoint sends and what happens to it (stored where, derived from
   what, or dropped and why); a test fails on a fixture field the list
   does not name; ingest counts fields it sees that the list does not
   name and emits a metric with an alarm, so a new field lands in the ops
   queue the day it appears. The question for Jamie is whether this
   becomes a permanent invariant in `docs/ENGINEERING.md` that every
   projector must honour, or whether the one-time census in Part 2 is
   enough. Recommended: the invariant, because the census goes stale the
   first time the API moves.

Applied without asking, because they follow from the six decisions: the
`game_day()` function; one row per subject per game day with `pre_reset`
and `season_roll` kinds; the elixir-bot import through the projector
function from a documented intermediate, with a `source` column and a
census before commit; the archive as the source of the backfill; the
receipt-ordered backfill op; the readers' shape; the phase order.

## How this was done

- **Schema:** the 125-migration ladder applied to a fresh scratch database
  (`createdb elixir_ts_scratch` + `cli.mjs migrate`, "0 already applied,
  125 ran"), read back with `pg_dump --schema-only`. Every candidate DDL
  below was executed in that database (Appendix A), then a synthetic year
  was generated to measure bytes per row and the reader plans; the build
  was repeated for the revised shape. The scratch database was dropped
  after this document was written.
- **Live, read-only:** the migrate Lambda's `{tables}`, `{stats}` and
  `{audit_census:{days:7}}` at 17:1xZ; `elixir_data_insights` and
  `game_clock` through the MCP door; the archive bucket listed by prefix
  (`ListObjectsV2`, counts and key spans only) and its CloudWatch storage
  metrics. The live database is not reachable from here and no networking
  was built; no clone was made.
- **Code:** every projector in `services/ingest/src`, the cadence table in
  `services/scheduler/src/plan.mjs`, every reader of `snapshot_date`, the
  three timeline tools, the migrate ops and the two Lambdas' IAM in
  `infra/template.yaml`.
- **Consumers:** `../poapkings.com` (scripts, `src/_data/clanTrends.json`,
  `src/data.js`, `OPERATOR.md`, the host crontab) and
  `../elixir-bot/elixir-v51.db` opened read-only (`?mode=ro`); its writers
  in `engine/projections.py` and `storage/roster.py`. Nothing was written to
  either.
- **The API:** `npm run cr` against every admitted endpoint once, printing
  key sets only (Appendix D), plus three own-profile reads for one field.

One thing learned here held for any caller and went to
`cr-agent-api-docs` (commit 8339a89): the `seasonal-trophy-road-YYYYMM`
progress bucket reads `trophies: 14000, bestTrophies: 0` on profiles at
14,000, 817 and 724 Trophy Road trophies alike, so it is the seasonal
road's own scale and not the player's count; the `""` bucket is the
Merge Tactics pre-season arena. Section 4.3 rests on it.

## The one-paragraph verdict

The recorder already keeps four kinds of series (player snapshots, the
two ledgers, the boards, the war tables) and one rollup grain (the
season), and it throws away the two series the game hands it most often.
A tracked clan's roster arrives up to 96 times a day and the projector
keeps four identity columns of it; seven clan fields and seven member
fields per poll are parsed and dropped, and `clan_daily_metrics`, the
table meant for them, was dropped in 0094 for never having been written.
The profile's `progress` bucket loses its values and keeps only its key.
Everything dropped is recoverable: the archive holds every distinct
payload since the first recorded day (POAP KINGS rosters daily from
2026-03-12, 10,781 objects; profiles from 2026-03-07), so the series can
be built from the archive, not from the migration, and the elixir-bot
import is the check, not the source. The design is one day key, the game
day; the roster writing the players' own snapshot rows (eight columns on
`player_snapshot_daily`); one clan table and one progress table; all
written by the two projectors that already hold the payload, backfilled
by a receipt-ordered op, and read by two new clan tools and one extended
one. A year for the 18 recorded clans is under 100 MB. The larger finding is the principle behind it: 41 fields
across the admitted endpoints are dropped with no recorded reason, and
nothing would notice a 42nd; the standing rule in 2.7 makes omission a
recorded decision and addition an alarm.

---

## Part 1: ground truth

### 1.1 What the recorder already holds as a series

Cadences are `CADENCE` and `yieldCadenceMinutes` in `plan.mjs`; row
counts are live `{tables}` at 17:1xZ on 2026-09-17.

| Table                                                        | Grain                                                                                                   | Real cadence of the source poll                                                                                                                                                                                                                                              | Rows live                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `player_snapshot_daily`                                      | one row per player per **UTC calendar day** of `fetchedAt` (`fetchedAt.slice(0, 10)`), kinds `daily` / `pre_reset` / `season_roll`; the last poll of the day wins under `observed_at >=` | profile: no floor; 8 h minimum once a fresher roster shows the player active (`DIRECT_PROFILE_CAP_MINUTES` 480 for anyone tracked directly), 24 h for most, 72 h dormant (`yieldCadenceMinutes` clamps 120..4320); forced in the hour before Monday 00:10Z and before the season roll; one extra poll per real arena promotion (0101) | 15,877 (14,852 daily, 996 pre_reset at 0111; 1,734 players with a snapshot, 1,352 in the last 7 days) |
| `player_event`, `clan_event`                                 | ledgers: one row per moment, `occurred_at` exact or `window_start..window_end` estimated                | emitted by the profile, collection, badge, roster, race and log projectors at their cadences                                                                                                                                                                                | 14,370 / 12,868                                    |
| `ranking_snapshot` + `ranking_entry`, `clan_ranking_entry`   | one snapshot per fetch **that changed** (content hash; an identical fetch bumps `last_confirmed_at`)    | every board daily, anchored to the board day; the global Path of Legends board was hourly until 0075 (2026-09-11); a season final once                                                                                                                                       | 1,432 snapshots, 770,299 + 40,970 entries          |
| `war_week`, `war_week_clan`, `war_participation`             | one row per clan per race week; per rival per week; per member per week (MAX-merged counters)           | `currentriverrace` every 30 min on war days, 120 min on training days (floor 120); `riverracelog` daily (floor 2 days)                                                                                                                                                       | 343 / 1,715 / 36,210                               |
| `war_attendance_day`                                         | one row per member per **war day** (`decks_used_today`, MAX-merged)                                     | same 30-minute poll, only while `warDay` is not null                                                                                                                                                                                                                         | 11,148                                             |
| `war_period` (calendar), `war_period_anchor` (observation)   | one row per policy day of every season (10:00Z grid); one first-sighting per clan per period            | seeded by `ensureSeason`; anchor on every race poll                                                                                                                                                                                                                          | 2,702 / 159                                        |
| `deck_meta_season`, `card_meta_season`, `meta_season_totals` | per **season** and mode group                                                                           | nightly rebuild 04:40Z, hourly increment :45                                                                                                                                                                                                                                 | 375,377 / 13,634 / 52                              |
| `player_daily_battle_rollup`                                 | per player per **UTC calendar day** per mode group per game mode, derived from battles                  | recomputed for every (player, day) a battlelog admission touched                                                                                                                                                                                                             | 246,935                                            |
| `game_event_day`                                             | one row per event per **UTC day** it was seen running                                                   | `/events` daily                                                                                                                                                                                                                                                              | 206                                                |
| `mode_season`                                                | state: one row per `Player.progress` key, `first_seen_at` / day-grained `last_seen_at`                  | every profile poll                                                                                                                                                                                                                                                           | 6                                                  |

Three day definitions coexist today: the UTC calendar day (snapshots,
the rollup, event sightings), the policy day at 10:00Z (`war_period`,
`war_attendance_day`), and the ISO week (`battles_trends`). Part 3 is
about the first two.

### 1.2 The clan gap

`services/ingest/src/roster.mjs` writes, from a clan payload: `clan`
(`name`, `badge_id`, hourly `last_seen_at`), `player` (`name`,
`last_seen_at`, `game_last_seen_at` by `greatest()`), and
`clan_membership` (open/close rows, `role`) plus the three membership
events. That is four identity columns and the tenure machine. Parsed and
dropped on every poll:

- clan: `clanScore`, `clanWarTrophies`, `members`, `requiredTrophies`,
  `donationsPerWeek`, `type`, `location`, `description`;
- every `memberList[]` entry: `trophies`, `donations`,
  `donationsReceived`, `clanRank`, `previousClanRank`, `arena`, and
  `lastSeen` as a series (only the latest value survives, on `player`).

The poll that carries them is the recorder's most frequent by subject: a
tracked clan reads every 15 minutes while three or more members are in
the game, hourly when nobody has been for an hour, every 4 hours after a
quiet day (up to 96 polls a day); an incidental clan (read only because a
recorded player is in it) every 4 / 12 / 24 hours. Live: 43,858 admitted
`clan` receipts, 18 clans with an active clan recording (10 `activity`,
8 `comprehensive`, ~725 members between them), 6,652 clans with a row,
24,775 open memberships across every polled clan.

`clan_daily_metrics` (0001: `clan_tag, day, member_count,
donations_total, metrics jsonb`) was never written by any projector and
was dropped in 0094 with that reason recorded. It is not brought back in
that shape.

### 1.3 The player gap

`projectModeSeasons` (`season.mjs`) reads `Object.keys(payload.progress)`
and upserts `mode_season`; the values (`trophies`, `bestTrophies`,
`arena`) never reach a row. Live today a profile carries four keys:
`""`, `2v2League_202609`, `AutoChess_2026_Season_11`,
`seasonal-trophy-road-202609` (Appendix D); the empty key is rejected by
`parseProgressKey` and so is not even in `mode_season`.

The six lifetime counters, and whether each belongs in the snapshot (the
lifetime block 0123 made columns: `battle_count`, `wins`, `losses`,
`three_crown_wins`, `star_points`, `exp_points`, `collection_level`):

| Field                    | Moves?                                                               | Belongs                                                                                                                                                    |
| ------------------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `challengeCardsWon`      | yes, on every challenge run                                          | **snapshot**, lifetime block: it is exactly the class `wins` is in                                                                                        |
| `challengeMaxWins`       | yes, rarely (a personal best)                                        | **snapshot**; a rise is also a `best`-class moment the ledger could name later                                                                            |
| `tournamentCardsWon`     | yes                                                                  | **snapshot**                                                                                                                                               |
| `tournamentBattleCount`  | yes                                                                  | **snapshot**                                                                                                                                               |
| `warDayWins`             | no: Clan Wars 1 ended in 2021; `0` on all three probed profiles      | **state on `player`**, written once when it differs (frozen counters are not a series); the site renders it as `clan_war_wins`, so it must exist somewhere |
| `clanCardsCollected`     | no, same era                                                         | **state on `player`**                                                                                                                                      |

Also in the profile and dropped: `totalDonations` (lifetime donations,
moves weekly; the site renders it as `total_clan_donations`; snapshot),
`legacyTrophyRoadHighScore` (frozen, nullable; state), `totalExpPoints`
(retired progression; state, once), `currentWinLoseStreak` (intraday,
derivable from the battle record; drop with that reason),
`lastPathOfLegendSeasonResult` (the previous season's final standing;
section 2.2), `achievements[]` (twelve fixed rows; section 2.2),
`badges[].iconUrls` (section 2.2). `kingTowerLevel` is on the payload
(16 on the probed profile) and documented in `cr-agent-api-docs` since
2026-09-02; it is dropped today and belongs in the snapshot (it moves
with card upgrades).

### 1.4 The archive

`processResult` puts every payload whose content hash is new to
`s3://elixir-mcp-archive-<account>/payloads/endpoint=<ep>/entity=<tag>/dt=<fetch date>/<stamp>-<hash16>.json.gz`
before the transaction commits; a content-identical refetch adds a
receipt and no object. Every replay (`{replay}`, with or without
`skip_projection`) archives the same way since 2026-09-15.

| Measured 2026-09-17                                        | Value                                                                                                                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bucket (CloudWatch, 2026-09-16 00:00Z)                     | 114,076 objects, 1.03 GB                                                                                                                                |
| `endpoint=clan/`                                           | 38,179 objects                                                                                                                                          |
| `endpoint=player/`                                         | 35,559 objects                                                                                                                                          |
| `endpoint=currentriverrace/`                               | 4,784 objects                                                                                                                                           |
| POAP KINGS rosters (`entity=J2RGCRVG`)                     | 10,781 objects, 28.1 MB gz, **189 days 2026-03-12 → 2026-09-17**, one missing day (2026-07-03); one object a day March–April (the v4 daily roster), 27 a day in May, 46 in June, 107 in July, 126 in August, 75 in September |
| King Thing's profile (`entity=20JJJ2CCRU`)                 | 1,037 objects, 132 days 2026-03-07 → 2026-09-17, 11.7 KB gz each; gaps 05-04 → 05-14 (11 days, the known backup hole) and **07-14 → 09-02 (51 days)** |
| Receipts (`{stats}`)                                       | clan 43,858; player 38,250; player_battlelog 71,293; currentriverrace 5,584; riverracelog 178                                                            |

The 51-day profile hole is not in the bot: `elixir-v51.db.raw_api_payloads`
holds 5,488 `player` payloads over those 51 days for 75 players (and
6,265 `clan` payloads, already replayed for tenure). The 2026-09-04
import took battle logs from the live database and the 2026-09-15 pass
took rosters, war state, events and cards; nobody replayed the live
database's profiles. That is the one archive fill the elixir-bot import
should make (Part 6): real API payloads through `{replay}`, not rows.

**IAM.** `MigrateRole` has `s3:PutObject, s3:GetObject` on `payloads/*`
and `s3:ListBucket`; `JobsRole` has `s3:GetObject` on `payloads/*` and
`s3:ListBucket`; both Lambdas sit in the private subnets with the S3
gateway endpoint (`template.yaml` line 167). **The backfill op needs no
IAM change.** It runs in the migrate Lambda (300 s, reserved concurrency
1, `ARCHIVE_BUCKET` set), like `{tower_hp_backfill}` and `{replay}`.

### 1.5 The two single-clan consumers

**poapkings.com.** `scripts/clash-data-store.js` keeps
`data/clash-royale.sqlite`: `clan_daily_snapshots` keyed on the
America/Chicago `snapshot_date` (`localDate(observedAt)`) with
`clan_score`, `total_trophies` (summed over members, the number the API
does not return), `clan_war_trophies`, `donations_per_week`,
`required_trophies`, `member_count`, `open_slots`, `type`,
`location_name`; `member_daily_snapshots` keyed `(snapshot_date,
player_tag)` with roster fields (`role`, `clan_rank`,
`previous_clan_rank`, `trophies`, `arena_name`, `last_seen`, `donations`,
`donations_received`) and profile fields (`best_trophies`, `exp_level`,
`battle_wins`, `battle_count`, `three_crown_wins`, `account_age_days`,
`account_age_years`, `collection_level`, `clan_war_wins`,
`total_clan_donations`, `badge_count`); `river_race_weeks` /
`river_race_standings` / `river_race_participants` from the log.
`src/_data/clanTrends.json` holds **163 points, 2026-03-11 → 2026-09-16**;
`src/data.js` draws four series over them (`clanScore`, `members`, `war`,
`donations`) and the trends export also carries `averageTrophies`,
`averageWins`, `averageYearsPlayed`, `averageCollectionLevel` and the
12k+ / 14k+ / 6-years+ / collection-1000+ counts per day. The build
(`update-roster.js`) is one `/clans/{tag}` read, one `/players/{tag}` per
member and one `/riverracelog?limit=20` a day from `CR_API_KEY` in
`../elixir-bot/.env`. The host crontab still runs
`0 6 * * * .../poapkings.com/scripts/auto-update.sh` every morning; that
script was deleted in commit 9421027 on 2026-03-06 ("Post-Elixir
migration cleanup"), so the cron has failed silently for six months and
`OPERATOR.md` describes an agent-run daily instead.

**elixir-bot** (`elixir-v51.db`, read-only):

| Table                         | Rows   | Span                                                     | Key                                                                                                                                                                                           |
| ----------------------------- | ------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `player_daily_metrics`        | 8,684  | 144 players, 195 consecutive Chicago days 2026-03-07 → 09-17 | `(player_tag, metric_date)`; `trophies`, `best_trophies`, `clan_rank`, `donations_week`, `donations_received_week`, `last_seen_api`, `exp_level`; **no observed_at**; trophies last-write, donations **MAX-merged** within the day (the writer's comment: the Monday 00:10Z reset is Sunday 19:10 Chicago, inside the day) |
| `clan_daily_metrics`          | 191    | 2026-03-11 → 09-17                                       | `(clan_tag, metric_date)`; `observed_at` present; `clan_score`, `clan_war_trophies`, `required_trophies`, `donations_per_week_requirement`, `weekly_donations_total`, `total_member_trophies`, `avg_member_trophies`, `top_member_trophies`, joins/leaves |
| `player_daily_battle_rollups` | 13,159 | 140 players, 253 days from 2026-01-03                    | `(player_tag, battle_date, mode_group, game_mode_id)`; Chicago `battle_date`; the slice ≤ 2026-04-17 is 2,371 rows, 83 players, 13,066 battles                                                 |
| `war_attendance_days`         | 2,641  | S133 → S136, from 2026-06-08                             | per war day per member, `decks_used`, `fame_delta`                                                                                                                                            |
| `pol_season_results`          | 189    | three seasons: 2026-06, 07, 08                           | `(pol_season_id, player_tag)`; `league`, `rating`, `global_rank`, `battles`, `wins`                                                                                                           |

The bot's day is `chicago_date_for_utc_timestamp(observed_at)`
(`db/__init__.py`), and its last roster read of a Chicago day lands at
04:00–05:00Z the next UTC morning (`clan_daily_metrics.observed_at`
modes: 04:50, 04:07, 04:59, 04:56, 04:57; 11 days at 17:00Z). No
`clan_daily_metrics` row has an `observed_at` before its own day's 10:00Z
and none at or after the next day's 10:00Z (0 and 0 of 191), which is
what makes the mapping in Part 6 clean.

---

## Part 2: capture completeness census

Jamie, 2026-09-17: "we should not be throwing away all this data." Every
field of every admitted payload (key sets probed live 2026-09-17,
Appendix D; semantics from `cr-agent-api-docs`) against the projector
that handles it. Classes: **P** projected (where); **D** derivable at read
(from what); **R** dropped with a recorded reason (where recorded);
**X** dropped with no reason. X is the finding; each X is labelled state
(one row per subject, overwritten on change under the observed_at guard),
series (one row per subject per game day), or ledger (an event when it
changes), and every one is in the plan.

### 2.1 `/players/{tag}` (profile projector, `pipeline.mjs` + `snapshots.mjs` + `cards.mjs` + `season.mjs`)

| Field                                                                           | Class | Where / why                                                                                                                                          |
| ------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tag`, `name`, `clan{tag,name,badgeId}`, `role`                                 | P     | `player`, `clan`                                                                                                                                     |
| `trophies`, `bestTrophies`, `arena.id`, `donations`, `donationsReceived`, `battleCount`, `wins`, `losses`, `threeCrownWins`, `starPoints`, `expPoints`, `collectionLevel`, `currentFavouriteCard.id`, `leagueStatistics.*`, `current/bestPathOfLegendSeasonResult` | P | `player_snapshot_daily` (0123 columns)                                                                        |
| `arena.name`                                                                    | P     | `arena` catalog; `arena.rawName`: **X, state** (the season namespace rides in it; one text column on `arena`)                                        |
| `cards[]`, `supportCards[]` (`id`, `level`, `count`, `evolutionLevel`, `starLevel`) | P | `player_card`; their `maxLevel`, `rarity`, `elixirCost`, `iconUrls`, `name`: D from `card`                                                          |
| `badges[]` (`name`, `level`, `maxLevel`, `progress`, `target`)                  | P     | `player_badge` (state, change-only); `badges[].iconUrls.large`: **X, state**: a `badge` catalog row per name (a few hundred rows) is the fix          |
| `currentDeck`, `currentDeckSupportCards`                                        | R     | 0094: client-synced, useless for Verify (`docs/NOTES` 2026-09-12)                                                                                    |
| `expLevel`                                                                      | R     | retired in-game 2026 (`cr-agent-api-docs/players.md`); not recorded by decision, reason to be written on the projector (2.7)                          |
| `kingTowerLevel`                                                                | **X, series** | new since 2026-09-02; snapshot column                                                                                                       |
| `totalDonations`, `challengeCardsWon`, `challengeMaxWins`, `tournamentCardsWon`, `tournamentBattleCount` | **X, series** | snapshot lifetime block (1.3)                                                                                              |
| `warDayWins`, `clanCardsCollected`, `legacyTrophyRoadHighScore`, `totalExpPoints` | **X, state** | frozen counters on `player`, written when they differ (once)                                                                                   |
| `lastPathOfLegendSeasonResult`                                                  | **X, ledger** | the previous season's final standing, carried on every poll of the following month and never kept: `player_pol_season (player_tag, season_month)` fill-once, the season being the latest `season.ends_at <= observed_at`. This is what makes the bot's `pol_season_results` unnecessary to import: the archive holds every recorded player's final for every season since March |
| `currentWinLoseStreak`                                                          | R (to write) | intraday; the battle record answers it exactly                                                                                                 |
| `progress` keys                                                                 | P     | `mode_season`; the `""` key rejected (**X, state**: keep it as its own key; it is the Merge Tactics legacy bucket, `cr-agent-api-docs` 8339a89)      |
| `progress[key].trophies`, `.bestTrophies`, `.arena`                             | **X, series** | `player_progress_daily` (4.3)                                                                                                                |
| `achievements[]` (12 fixed: name, stars, value, target, info)                   | **X, state** | `player_achievement (player_tag, name)` change-only like badges; 12 rows a player, ~21k rows; cheap, low value, Tier 2                          |

### 2.2 `/clans/{tag}` (roster projector, `roster.mjs`)

| Field                                                                                          | Class  | Where / why                                                                                                             |
| ---------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------- |
| `tag`, `name`, `badgeId`                                                                       | P      | `clan`                                                                                                                  |
| `memberList[].tag`, `.name`, `.role`, `.lastSeen` (latest only)                                | P      | `player`, `clan_membership`                                                                                             |
| `members`                                                                                      | P/D    | admission cross-check only; equals `memberList.length` by admission                                                     |
| `clanScore`, `clanWarTrophies`, `requiredTrophies`, `donationsPerWeek`                         | **X, series** | `clan_snapshot_daily` (4.1)                                                                                       |
| `type`, `location.id`, `description`                                                           | **X, state** | `clan.type`, `clan.location_id`, `clan.description` (change-only); `type` and `location_id` also ride the series row by decision 5 |
| `location.name`, `.isCountry`, `.countryCode`                                                  | D      | `ranking_board` already carries label and `country_code` per location key; a `location` catalog (262 rows from `/locations`) is the honest home, Tier 3 |
| `clanChestStatus`, `clanChestLevel`, `clanChestMaxLevel`, `memberList[].clanChestPoints`       | R (to write) | clan chests no longer exist in-game (`cr-agent-api-docs/clans.md`)                                                |
| `memberList[].expLevel`                                                                        | R (to write) | reads `0` for every member since the 2026 retirement                                                              |
| `memberList[].trophies`, `.donations`, `.donationsReceived`, `.clanRank`, `.previousClanRank`, `.arena.id` | **X, series** | the player's own `player_snapshot_daily` row, written by the roster (4.2). Arena here moves at the 15-minute roster cadence; the profile's inherits the 8-hour poll (NOTES 2026-09-15, "Arena moves within the hour") |
| `memberList[].lastSeen` per poll                                                               | **X, series** | the presence series the record never keeps: `player_snapshot_daily.game_last_seen_at`, the day's last value (4.2) |
| `memberList[].arena.name`, `.rawName`                                                          | D / X  | `arena` catalog; the roster is a second source of arena names and should feed it (today only the profile does)        |

### 2.3 `/clans/{tag}/currentriverrace` and `/riverracelog` (`war.mjs`)

| Field                                                                                                   | Class | Where / why                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `periodIndex`, `sectionIndex`, `periodType`                                                             | P     | `war_period_anchor`, `poll_state.period_type`; the day is resolved on `war_period`                                                                                                 |
| `state`                                                                                                 | R (to write) | always `full` (`cr-agent-api-docs/river-race.md`)                                                                                                                          |
| `clan.tag`, `clans[].tag/name/fame/periodPoints/finishTime`                                             | P     | `war_week_clan`                                                                                                                                                                   |
| `clans[].badgeId`, `clans[].clanScore`, `clans[].repairPoints`                                          | **X** | `badgeId` → `clan.badge_id` for the rivals (state, the clan row exists); `clanScore` → `war_week_clan.clan_score` (state, latest under an observed_at guard: the rival's score at the week); `repairPoints` → `war_week_clan.repair_points` MAX-merged |
| `clan.participants[]` `fame`, `decksUsed`, `boatAttacks`, `decksUsedToday`                              | P     | `war_participation`, `war_attendance_day`                                                                                                                                         |
| `clan.participants[].repairPoints`                                                                      | **X, state** | `war_participation.repair_points` MAX-merged, beside `boat_attacks`                                                                                                        |
| `periodLogs[]` (`periodIndex`, `items[].clan`, `pointsEarned`, `progressStartOfDay`, `progressEndOfDay`, `progressEarned`, `endOfDayRank`, `numOfDefensesRemaining`, `progressEarnedFromDefenses`) | **X, ledger** | the race's day-by-day results per clan, present on every race poll for the whole season so far, never kept: `war_period_log` (4.4), fill-once per closed day, scoped to its section by `period_index / 7` |
| `riverracelog.items[].createdDate/seasonId/sectionIndex`, `standings[].rank/trophyChange/clan.fame/finishTime`, participants | P | `war_week.closed_at`, `war_week_clan`, `war_participation`                                                                                                              |
| `riverracelog.standings[].clan.periodPoints/clanScore/repairPoints/badgeId`, participants' `repairPoints`, `decksUsedToday` | **X** | the same columns as the live race; `decksUsedToday` in a closed log is the last day's count and goes to `war_attendance_day` for war day 4 when the live poll missed it |
| `paging`                                                                                                | D     | truncation signal; the log poll takes the API's default page                                                                                                                      |

### 2.4 `/players/{tag}/battlelog` (`battles.mjs`, `deck-cards.mjs`)

| Field                                                                                                            | Class | Where / why                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`, `battleTime`, `gameMode.id/name`, `arena.name`, `leagueNumber`                                           | P     | `battle`                                                                                                                                                        |
| `team/opponent[].tag/name/crowns/trophyChange/startingTrophies/elixirLeaked/kingTowerHitPoints/princessTowersHitPoints/clan.tag` | P | `battle_participant`                                                                                                                                    |
| `cards[]`, `supportCards[]`, `rounds[].cards[]` (`id`, `level`, `evolutionLevel`, `starLevel`)                   | P     | `deck`, `deck_card`, `battle_participant_card` (per round)                                                                                                       |
| `boatBattleWon`                                                                                                  | P     | consumed into `outcome`, not stored as itself (fine: `outcome` is lossless for it)                                                                              |
| `modifiers`                                                                                                      | R     | 0112 (dead column; CHAOS modifiers had no reader)                                                                                                               |
| `arena.id`                                                                                                       | **X, ledger** | only the name is kept; the arena FKs (Phase F, step 17) want the id: `battle.arena_id`                                                                    |
| `eventTag`, `tournamentTag`, `deckSelection`, `isLadderTournament`, `isHostedMatch`, `boatBattleSide`, `newTowersDestroyed`, `prevTowersDestroyed`, `remainingTowers` | **X, ledger** | facts of the battle row, never changing: nine nullable columns on `battle` (4.4); `eventTag` joins `game_event` without a key (a battle can name an event never sighted) |
| `rounds[].crowns/kingTowerHitPoints/princessTowersHitPoints/elixirLeaked`                                        | **X, ledger** | per-round results of a duel; the top-level values are the sum and the final round (`cr-agent-api-docs/models/battles.md`): `battle_participant_round (battle_id, player_tag, round)` with the four columns; Tier 2 |
| `rounds[].cards[].used`                                                                                          | **X, ledger** | whether a card was played in that round; one boolean on `battle_participant_card` (nullable, duel rows only); Tier 2                                       |
| `team/opponent[].globalRank`                                                                                     | **X, ledger** | null unless globally ranked at battle time; `battle_participant.global_rank smallint`; Tier 2                                                             |
| `team/opponent[].clan.name/badgeId`                                                                              | D     | the clan row, when it exists; a label otherwise (same decision as `ranking_entry.clan_tag`, review 1.3)                                                        |
| `challengeWinCountBefore`, `challengeId`, `challengeTitle`                                                       | D (absent) | official-only; not observed live (Appendix D); the unknown-key metric (2.7) is how their arrival would be noticed                                           |

### 2.5 `/cards`, the boards, `/leaderboards`, `/events`, `/globaltournaments`

| Endpoint / field                                                                        | Class | Where / why                                                                                                                    |
| --------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------ |
| `cards.items[]`, `supportItems[]` (all seven fields)                                    | P     | `card` (0123 icon columns)                                                                                                     |
| ranking boards `items[].tag/name/rank/eloRating|trophies|score/clan.tag/clan.name`      | P     | `ranking_entry`                                                                                                                |
| `items[].expLevel`                                                                      | R (to write) | retired field                                                                                                            |
| `items[].clan.badgeId`                                                                  | D     | a label on a board entry; the clan row is not created for player boards by decision (review 1.3)                               |
| clan boards `items[].rank/previousRank/tag/name/clanScore|clanWarTrophies/members/badgeId/location.id` | P | `clan_ranking_entry`                                                                                                   |
| `paging.cursors.after`                                                                  | P     | `ranking_snapshot.truncated`                                                                                                   |
| `/leaderboards` `id`, `name` (nullable)                                                 | P     | `ranking_board`                                                                                                                |
| `/events` `eventTag`, `title`, `description`                                            | P     | `game_event`, `game_event_day`                                                                                                 |
| `/globaltournaments` items                                                              | R     | 0094: `game_tournament` was written and never read; the payload is archived and re-projectable                                 |

### 2.6 The count

41 fields or field groups are dropped with no recorded reason: 14 on
the profile, 12 on the roster, 8 on the race and log, 7 on the battle
log. Nine are series (the roster's columns on the snapshot, the clan
table, the progress table), eleven are state, the rest ledger facts. Five more are dropped for a good
reason that is not written anywhere a reader of the projector would find
it (`expLevel` twice, the clan chest trio, `state`, `currentWinLoseStreak`).

### 2.7 The standing rule (proposed text for `docs/ENGINEERING.md`, "Ingest invariants")

> **A payload field is projected or its omission is recorded.** Every
> endpoint's projector carries a key manifest
> (`services/ingest/src/payload-keys.mjs`): for each key the API sends,
> at the top level and inside each array's elements, either the table
> and column it lands in, or `derived: <from>`, or `dropped: <reason>`.
> A test walks every fixture payload and fails on a key the manifest does
> not name, and fails on a manifest entry with no disposition. Admission
> (`admission.mjs`) counts the keys of each admitted payload that the
> manifest does not name and emits them on the receipt's EMF line as
> `ElixirMCP/Record UnknownPayloadKeys` with an `endpoint` dimension; the
> alarm `elixir-mcp-unknown-payload-keys` fires at 1 and routes to
> `elixir-mcp-alarms`. A field the API adds is therefore noticed the day
> it appears, by name, and the manifest entry that silences the alarm is
> the recorded decision. Nothing hand-fed: the manifest describes what the
> API sends and the archive already holds.

Cost: the key walk is one pass over the payload's top level and the first
element of each array (a roster is 50 members × 12 keys; a battlelog 30 ×
2 sides × 13), microseconds beside the gunzip. The EMF line rides the
same stdout the receipt timings already use. The manifest is the census
above, written as data; the test is the census run on every commit.

---

## Part 3: the day

### 3.1 The game day, one function

Decision 1: a series row's day key is the date whose 10:00Z start the
observation falls after. Executed in the scratch build:

```sql
create or replace function game_day(at timestamptz) returns date
  language sql immutable parallel safe strict
  as $$ select ((at at time zone 'UTC') - interval '10 hours')::date $$;
```

Checked: `game_day('2026-09-17T09:59:59Z') = 2026-09-16`,
`game_day('2026-09-17T10:00:00Z') = 2026-09-17`,
`game_day('2026-09-18T04:59:00Z') = 2026-09-17`, and for every
`war_period` row `game_day(starts_at) = game_day(ends_at - 1 s)`: the
game day and the policy day are the same partition, so a war day, a
season roll (first Monday 10:00Z) and a series row never straddle. UTC
arithmetic only, so DST cannot move it (the 0105 lesson). Timezone stays
a display concern: `applied.window.timezone` echoes the zone the bounds
were resolved in, and the row's `day` is the game's.

### 3.2 `player_snapshot_daily`: move to the game day, or keep two definitions

Today its key is the UTC calendar day of `fetchedAt`. Readers of
`snapshot_date` outside the projector: `players_timeline` (date bounds,
the week grouping), `players_summary` / `players_profile` /
`clans_roster` / `collections` / `battles` / `recorded-profile` (the
latest row by `snapshot_date desc, snapshot_kind desc`), `coverage.mjs`
and `jobs/activity.mjs` (windows ordered by day), `participation-sql.mjs`
(`date_trunc('week', snapshot_date)`), `elixir.mjs` (min/max, last 7
days), and `shared.mjs` (`min(snapshot_date)` as an epoch). Ten call
sites, all of which work unchanged on any monotone day key.

**Two definitions are not available any more.** The roster now writes
the same row the profile does (4.2), so a member's trophies from a
roster poll at 12:00Z and from a profile poll at 16:00Z must land in the
same day row: whatever day key the table has is the day key of both
sources. The question is only which one. Under the UTC calendar day the
Monday pre-reset row sits in Monday while the game files that hour under
Sunday, and the `season_roll` row (the hour before Monday 10:00Z) shares
the roll Monday with fourteen hours of the new season; under the game
day it is the last row of the old season and the first game-day row is
the first of the new one.

**Moving costs this:** 15,877 rows re-keyed by `game_day(observed_at)`
(a UTC day whose last poll was before 10:00Z maps to the previous game
day); where two UTC-day rows map to one game day (day D's poll at 23:00Z
and day D+1's only poll at 08:00Z) the later `observed_at` wins and the
earlier row is dropped, which is precisely the rule's own semantics (that
earlier poll would never have been kept), and the payload is in the
archive either way. The kind rows (`pre_reset`, `season_roll`) re-key the
same way and cannot collide. The PK contains `snapshot_date`, so the op
is delete-and-reinsert per player in keyset batches of ~500 players
(15.9k rows is "over a few thousand": an op, not a migration; ~30 s on
the micro), preceded by a read-only census that reports the collision
count and the rows that would move a day. The column keeps its name
(`snapshot_date`), its meaning changes, and the `players_timeline`
note changes from "Snapshot days are UTC dates" to the game day.

**Decided (Jamie, 2026-09-17): move it**, in Phase 1, before the roster
starts writing the row. Evidence: ten readers that need no change, one
kind row that becomes correct, ~16k rows, and a validation op that says
exactly what moves before it does.

### 3.3 `player_daily_battle_rollup` stays on the UTC calendar day, stated

It is an aggregate over battle instants, its readers (`daily-sql.mjs`)
treat every window as instants and take whole days only strictly inside
it, and no tool exposes its day as a game day. Moving it is a 247k-row
delete-and-reinsert and a change to the edge-day logic. Not in this plan;
listed in Tier 2 as the last day definition to fold once the series are
in. The elixir-bot rollup import (Part 6) maps onto it as it is.

### 3.4 Kinds

Decision 2: `daily`, plus `pre_reset` for the row from the hour before
the Monday 00:10Z donation reset (`inPreResetWindow`, contracts) and
`season_roll` for the hour before `season.ends_at`
(`inSeasonRollWindow`). The roster's writes get both: `donations`,
`donations_received` and `donationsPerWeek` reset weekly; member
`trophies` and `clanScore` change at the season roll (the seasonal
Trophy Road resets above its threshold). The progress series gets
`season_roll` only (its buckets are per season) and `pre_reset` never
(nothing in it is weekly). The projector writes the extra row the same
way `projectPlayerSnapshot` does: same function, `kind` argument, called
twice inside the window. The scheduler already forces profile polls
inside both windows; it does not force roster polls, and a tracked clan
at 15 minutes lands ~4 polls in the hour anyway. An incidental clan at
4–24 hours may miss the window; that is a `pre_reset` row absent, never a
wrong one.

---

## Part 4: the tables

All DDL below ran in the scratch build (Appendix A). Every write is the
ingest invariant's shape: `on conflict ... do update ... where
excluded.observed_at >= t.observed_at and (t.cols) is distinct from
(excluded.cols)`; checked in the scratch that a repeated identical poll
writes zero rows. `source` marks imported rows (Part 6). `receipt_id`
on the clan row is provenance for the backfill (one row per day, so one
bigint a day); the player rows carry none (a receipt per member per day
would be the widest column on the table).

### 4.1 `clan_snapshot_daily`, written by the roster projector

```sql
create table clan_snapshot_daily (
  clan_tag          text not null references clan,
  day               date not null,
  snapshot_kind     text not null default 'daily'
                    check (snapshot_kind in ('daily', 'pre_reset', 'season_roll')),
  observed_at       timestamptz not null,
  receipt_id        bigint references api_receipt,
  source            text not null default 'api' check (source in ('api', 'elixir-bot')),
  clan_score        integer,
  clan_war_trophies integer,
  members           smallint,
  required_trophies integer,
  donations_per_week integer,
  type              text,
  location_id       integer,
  primary key (clan_tag, day, snapshot_kind)
);
```

Key: `(clan_tag, day, snapshot_kind)`, which is also the only index: the
timeline read is a range on it (plan in Appendix A: 160 days = 160 index
tuples, 5 buffers). One row per admitted roster per game day, for every
clan the recorder polls (an incidental clan's row is one poll it already
made; 6,652 clans × 1 row × 173 bytes = 1.1 MB a day, 420 MB a year at the
current clan count; the 18 recorded clans alone are 1.1 MB a year).
Recommendation: **every admitted roster**, because the row costs nothing
beyond the poll and the branch would be the first thing in the projector
keyed on who is tracking.

### 4.2 The roster writes the player's own snapshot row

A clan member is a player, and a roster poll is a partial profile read
of fifty of them. The member series is therefore not a table of its own:
it is `player_snapshot_daily`, written by two projectors. The profile
projector writes the whole row as today. The roster projector writes the
subset the roster carries, into the same row, and leaves every other
column alone.

```sql
alter table player_snapshot_daily
  add column clan_tag            text references clan,   -- the clan the roster came from that day
  add column clan_rank           smallint,
  add column previous_clan_rank  smallint,
  add column game_last_seen_at   timestamptz,            -- the game's lastSeen as of the winning observation
  add column profile_observed_at timestamptz,            -- when the profile-only columns were last observed
  add column source              text not null default 'api' check (source in ('api', 'elixir-bot'));
create index player_snapshot_daily_clan_day
  on player_snapshot_daily (clan_tag, snapshot_date) where clan_tag is not null;
```

The roster's columns are `trophies`, `donations`, `donations_received`,
`arena_id` (already on the row) plus `clan_tag`, `clan_rank`,
`previous_clan_rank` and `game_last_seen_at`. The profile's columns are
everything else. `observed_at` is the newest observation of either
source and dates the roster's columns; `profile_observed_at` dates the
profile's, and is null on a day the roster wrote and no profile poll
did. That second timestamp is the one real cost of two writers on one
row: without it, a 15-minute roster write would make an 8-hour-old
Path of Legends rating look fresh. Each writer's upsert guards on its own
columns and its own timestamp (the roster's guard is `observed_at`, the
profile's is `profile_observed_at`, and the profile write also advances
`observed_at`), so neither can regress the other and a replayed old
payload from either side writes nothing. Checked in the scratch
(Appendix A): a roster write after a same-day profile write moves
trophies and keeps `wins` and `profile_observed_at` untouched.

What this buys beyond one table fewer: every member of a recorded clan
has a daily row whether or not their profile is recorded (decision 5),
with the roster's arena at the 15-minute cadence rather than the
profile's 8-hour one, and the presence series (`game_last_seen_at`,
the day's last value, which is what "was in the game on day D" means)
in the same row as everything else about the player that day. `role` is
deliberately not copied: it is state on `clan_membership` and its
changes are `role_changed` events. `arena_id` keeps its deferred foreign
key (step 17).

One new index, `(clan_tag, snapshot_date)`, partial on the rows that
have a clan: it is the clan timeline's per-day aggregate over the
members (`sum(trophies)`, `avg(trophies)`, `count(*)` for 160 days: one
bitmap scan, ~240 buffers, Appendix A) and the member series scoped by
clan. The existing primary key `(player_tag, snapshot_date, kind)`
answers the member's own line (180 days = 180 tuples, 190 buffers).

**Who gets a row: every member of every polled clan** (Jamie,
2026-09-17: the goal is a comprehensive record, and the data is already
in hand). No branch on tracking in the projector, which is also decision
6's shape. The numbers: 24,775 open memberships across 6,652 polled
clans today, ~24,800 rows a day, 9.0M rows and **2.3 GB a year** at the
258 bytes/row measured with the profile columns mostly null, on a 20 GB
gp3 volume holding 4.1 GB today and auto-scaling to 100. The 18
recorded clans' ~725 members are 68 MB of that. The growth is the
second-largest in the database after `battle_participant` (~900 MB a
year) and tracks the number of clans the recorder follows, so the
Phase 1 NOTES entry records the table's size and a month later the
first measured rate.

**Write churn.** The day row is rewritten by each poll that moves any
roster column. For an active tracked clan `lastSeen` moves on most polls
for most members, so the row would take a new tuple version up to 96
times a day: ~4,500 updates a day per clan on top of the table's 36,703
updates on 12,764 inserts today, all HOT (no indexed column changes, and
the new index is on `clan_tag`, which does not move). Proposed rule: a
poll that moves **only** `game_last_seen_at` writes when the new value
is an hour or more past the stored one, the rule `player.last_seen_at`
already follows; anything else moving writes at once. That keeps the
presence series to the hour inside a day and cuts the churn about four
times.

### 4.3 `player_progress_daily`, written by the profile projector

```sql
create table player_progress_daily (
  player_tag     text not null references player,
  progress_key   text not null references mode_season,
  day            date not null,
  snapshot_kind  text not null default 'daily'
                 check (snapshot_kind in ('daily', 'pre_reset', 'season_roll')),
  observed_at    timestamptz not null,
  trophies       integer,
  best_trophies  integer,
  arena_id       integer,
  primary key (player_tag, progress_key, day, snapshot_kind)
);
```

Named for what the API calls the bucket (`progress`), not for the key
table. The primary key is the only index: a player's series for all keys
over 180 days is one range (Appendix A: 540 tuples, 170 buffers). Written
by `projectModeSeasons` beside the `mode_season` upsert it already does,
with the `""` key admitted as a real key (`mode_season` row `''`, mode
`AutoChess`, no month).

**Row count is the cost here, and the rule that bounds it.** Every
profile poll carries four buckets today; 1,352 players had a snapshot in
the last 7 days, so a row per bucket per polled player per day is ~5,400
rows a day, 2.0M a year, **410 MB** at the 209 bytes/row measured, four
times the snapshot table's own growth. Three of the four buckets read
`trophies 0, bestTrophies 0` for a player who has not played that mode
this season (all three probed profiles, for Merge Tactics and 2v2), and
the seasonal Trophy Road bucket reads a constant 14,000 until a player
climbs it (`cr-agent-api-docs` 8339a89). Decided (Jamie, 2026-09-17, "no record for no
activity"): **a bucket with `trophies = 0 and bestTrophies = 0` writes
no row** (the absence is the fact, and `mode_season` still records that
the key exists), and a bucket whose values equal the previous game-day
row's still writes today's row (one row per subject per day, decision
2). Estimated ~1,800 rows a day, 660k a year, **140 MB**.

### 4.4 The state and ledger additions from the census

All executed in the scratch; all instant (nullable columns, new tables).

```sql
alter table clan add column type text, add column location_id integer, add column description text;
alter table player_snapshot_daily                        -- beside the roster columns of 4.2
  add column total_donations integer, add column challenge_cards_won integer,
  add column challenge_max_wins integer, add column tournament_cards_won integer,
  add column tournament_battle_count integer, add column king_tower_level smallint;
alter table player add column war_day_wins integer, add column clan_cards_collected integer,
  add column legacy_trophy_road_high_score integer;

create table player_pol_season (
  player_tag    text not null references player,
  season_month  text not null references season,
  league        integer, trophies integer, rank integer,
  observed_at   timestamptz not null,
  primary key (player_tag, season_month)
);

create table war_period_log (
  clan_tag text not null, season_id integer not null, section_index integer not null,
  period_index integer not null, participant_clan_tag text not null,
  points_earned integer, progress_start integer, progress_end integer, progress_earned integer,
  end_of_day_rank smallint, defenses_remaining smallint, progress_from_defenses integer,
  observed_at timestamptz not null,
  primary key (clan_tag, season_id, section_index, period_index, participant_clan_tag),
  foreign key (clan_tag, season_id, section_index) references war_week (clan_tag, season_id, section_index)
);

alter table battle
  add column arena_id integer, add column event_tag text, add column tournament_tag text,
  add column deck_selection text, add column is_ladder_tournament boolean, add column is_hosted_match boolean,
  add column boat_battle_side text, add column new_towers_destroyed smallint,
  add column prev_towers_destroyed smallint, add column remaining_towers smallint;
```

The `battle` columns are the one contract-shaped change in this list:
`battles_query` full verbosity would carry them (minor). Their fill is a
batched op over the 71,293 `player_battlelog` receipts (the archived
object is the filtered array since 2026-09-11 and the full log before;
every inserted battle is in some object), the 0099 shape, ~1.5 h on the
micro; Phase 2b, after the series backfill.

### 4.5 Size a year (the numbers)

| Table                                     | Bytes/row (measured) | Rows a day                                     | A year                             |
| ----------------------------------------- | -------------------- | ---------------------------------------------- | ---------------------------------- |
| `clan_snapshot_daily`, 18 recorded clans  | 173                  | 18                                             | 1.1 MB                             |
| same, every polled clan                   | 173                  | ~6,650                                         | 420 MB                             |
| `player_snapshot_daily` roster-written rows, every polled clan (decided) | 258 | ~24,800 (the ~1,350 with a recorded profile already have a row) | **2.3 GB** |
| same, the 18 recorded clans' members alone | 258 | ~725 | 68 MB |
| `player_progress_daily`, zero-bucket rule | 209                  | ~1,800                                         | 140 MB (410 MB without the rule)   |
| snapshot + player + clan columns          | ~24 extra bytes/row  | ~1,350 snapshots                               | 12 MB                              |
| `player_pol_season`                       | ~90                  | ~1,700 a month                                 | 2 MB                               |
| `war_period_log`                          | ~120                 | 18 clans × 5 rivals × 4 war days a week        | 2 MB                               |
| `battle` columns                          | ~20 extra bytes/row  | ~1,800 battles                                 | 13 MB (+5 MB once for the backfill)|

The decided set: **~2.5 GB a year**, 2.3 GB of it the roster rows, on a
20 GB gp3 volume (auto-scales to 100) with 4.13 GB used, against
`battle_participant` growing ~900 MB a year today. Retention is never, like every game-data table.

### 4.6 Cost per poll

Roster poll (`ingestClanRoster`) today: 3 statements plus a loop of 1–2
statements per changed member. Adds: one upsert on
`clan_snapshot_daily` (1 row) and one multi-row upsert of the roster
columns on `player_snapshot_daily` (`unnest`, tag-ordered as the
`player` upsert is, so the lock order is the one the repo uses), in the
same transaction, plus the two kind rows inside their windows. Rows written
per poll: at most 1 + members that moved (0 when nothing did). Profile
poll: one multi-row upsert of ≤4 rows on `player_progress_daily`, five
more parameters on the snapshot upsert, one guarded update on `player`
for the frozen counters, one fill-once insert on `player_pol_season`.
Each projector returns `facts` including these rows (0077: the receipt
says what the fetch was worth), so a roster poll that moved fifty members'
trophies is finally worth fifty facts rather than zero.

---

## Part 5: the backfill from the archive

**Receipts, not objects, are the walk.** An archived object exists once
per distinct content; the receipts are one per admitted fetch, including
the content-identical refetches that live projection would have written
a day row from. Walking receipts reproduces exactly what the live
projector would have done, in order, and gives a keyset cursor that is
already indexed (`api_receipt_entity`).

`{series_backfill: {lane: 'clan' | 'player', budget_s: 240, batch: 200}}`
in the migrate Lambda:

1. Read the lane's cursor from `series_backfill_state` (4.4 DDL; one
   row per lane, `after_receipt_id`).
2. Select the next `batch` admitted receipts for the lane's endpoint by
   `receipt_id`, with `entity_key`, `fetched_at`, `payload_hash`.
3. For each, resolve the object key: the key is
   `archiveKey(endpoint, entity, first_fetched_at, hash)` and
   `first_fetched_at` is the first receipt with that hash for that
   entity, which the same walk knows (a per-entity `hash -> key` map,
   filled by one `ListObjectsV2` per entity on first sight; 38k + 36k
   objects, listed once). GET, gunzip, parse; cache the parsed payload by
   hash for the run so a refetch costs no GET.
4. Call the series half of the projector only (`projectClanSeries`,
   which writes the clan row and the roster columns of the members'
   snapshot rows; `projectPlayerProgress` and the snapshot's new profile
   columns on the player lane): never the membership machine, never
   events, never `poll_state`. The projectors are split so that the live
   path and the backfill call the same function with
   `observedAt = receipt.fetched_at`, `receiptId` the receipt. The
   per-source guards of 4.2 make the order irrelevant to the result and
   keep a roster replay from touching profile columns; the receipt order
   makes it monotone anyway.
5. Commit per batch, advance the cursor, stop when `budget_s` is spent
   or the lane is done (`finished_at`), return
   `{done, receipts_done, rows_written, next_after}`.

A local loop (`infra/scripts/series-backfill.mjs`, the shape of
`backfill-replay-backups.mjs`: invoke, read `done`, repeat) drives it to
completion **before any deploy that reads the tables**, because the
migrate Lambda's reserved concurrency is one and a deploy's migrate
invoke returns 429 and waits behind it (NOTES 2026-09-17, Phase E).

**How much and how long.** Clan lane: 43,858 receipts over 38,179
objects; player lane: 38,250 receipts over 35,559 objects (11.7 KB gz
each). Per receipt ~60–90 ms on the micro (in-VPC S3 GET 20–30 ms,
gunzip and parse of a 60 KB profile ~5 ms, one or two small upserts
5–20 ms; the 2026-09-15 replay measured ~45 ms a roster with the S3 put
dominating): **~50 min a lane, ~1.7 h in ~25 invocations of 240 s**. The
elixir-bot profile replay for the 51-day hole (Part 6) runs first so the
player lane sees those receipts too.

The clan rows and the members' roster columns land for every clan the
archive holds a roster for, which is every clan ever polled (6,652;
decision 2). For POAP KINGS the result is 189 game days from 2026-03-12 with
one absent day, the elixir-bot rows never touched.

---

## Part 6: the elixir-bot import and the validation census

Decision 3: history import is in scope and is the validation; nothing in
elixir-bot changes.

### 6.1 What the import adds, and what it only checks

The archive already holds POAP KINGS' rosters from 2026-03-12 and its
members' profiles from 2026-03-07, both with holes (1.4). The import is
three things:

1. **Real payloads for the 51-day hole.** `raw_api_payloads` `player`
   rows 2026-07-15 → 09-03 (5,488 payloads, 75 players) replayed through
   `{replay}` under the `backfill-elixir-bot` gateway, exactly as the
   2026-09-15 pass replayed rosters. This runs the full profile projector
   (snapshots, badges, cards, `player_pol_season`, progress), archives
   each payload, and fills `player_snapshot_daily` for those days as
   well. Nothing synthesized. ~8 min.
2. **The bot's series for the days the archive lacks**: five days of
   member rows before the first roster (2026-03-07 → 03-11, from
   `player_daily_metrics`), one absent roster day (2026-07-03), and the
   rollup slice (6.3). Written through the projector function, never by
   hand-written rows, from a documented intermediate.
3. **The census over every overlapping day** (6.4), which is Jamie's
   validation.

### 6.2 The intermediate, and the day-key mapping

`infra/scripts/elixir-bot-series-export.mjs` reads the bot's database
read-only (`node:sqlite`, `?mode=ro`, never `immutable`) and writes one
JSONL line per bot day in the roster payload's own shape: `{tag, name,
members, clanScore, clanWarTrophies, requiredTrophies, donationsPerWeek,
memberList: [{tag, trophies, donations, donationsReceived, clanRank,
lastSeen}]}` from `clan_daily_metrics` joined to `player_daily_metrics`
on the date, with `fetched_at = clan_daily_metrics.observed_at` (the bot
wrote both tables from the same tick; `player_daily_metrics` carries no
time of its own). Fields the bot never kept are absent, not zero:
`previousClanRank`, `arena`, `type`, `location`. The file is the
documented intermediate; `{series_import: {rows}}` (migrate Lambda) calls
`projectClanSeries` per line with `source: 'elixir-bot'` and no receipt.

**The mapping.** A bot row for Chicago day D is the last observation of
[D 05:00Z, D+1 05:00Z) (CDT; 06:00Z under CST, which only 2026-03-07
touches). Game day D is [D 10:00Z, D+1 10:00Z). Every bot `observed_at`
falls in [D 10:00Z, D+1 10:00Z) (0 of 191 before its day's 10:00Z, 0 at
or after the next), so **Chicago day D maps to game day D**, row for
row, with `observed_at` carried as the bot's own.

**The residual, per row.** The bot's day ends five hours before the game
day's: whatever moved between ~05:00Z and 10:00Z of D+1 (late-evening
play in the Americas, mornings in Europe) is in the recorder's row for D
and not in the bot's. For `trophies`, `clan_rank`, `clan_score` and
`clan_war_trophies` that is the honest bound: "as of 04:5xZ" against "as
of 09:5xZ". For `donations` the bot MAX-merges within the day (its
writer's comment explains why: the Monday 00:10Z reset is Sunday 19:10
Chicago); the record's rule is last-wins with a `pre_reset` row. So: on
Chicago Sundays the bot's `donations_week` is the week's peak and is
imported as the **`pre_reset`** row of game day Sunday (which contains
Monday 00:10Z), and the Sunday `daily` row's donations are left **null**
(the post-reset value is unrecoverable: absence over a guess); on every
other day the MAX equals the last value on a counter that only climbs
inside a day, so `daily` takes it. `last_seen_api` maps to
`game_last_seen_at` as is. `best_trophies` and `exp_level` in the bot's
row are profile columns the roster write never touches; the import
leaves them and `profile_observed_at` null (the profile archive has
them).

### 6.3 `player_daily_battle_rollups` → `player_daily_battle_rollup`

Rows with `battle_date <= 2026-04-17`: 2,371 rows, 83 players, 13,066
battles. The record's rollup keys on the **UTC calendar day** of
`battle_time` (3.3); the bot's on the Chicago day. Mapping: Chicago day D
→ UTC day D, with the stated residual that a battle between 00:00Z and
05:00Z of D+1 is Chicago D and UTC D+1 (up to five hours of a row's
battles filed a day early; the rollup has no battle times to split by).
Mode groups: `ladder`, `ranked`, `war`, `tournament` as is;
`friendly`, `two_v_two`, `other` and `special_event` → `casual` (the
record's `MODE_GROUP_BY_TYPE` puts `friendly`, `clanMate2v2` and `trail`
there); `game_mode_id` as is (0 when null); `battles_captured` from the
bot's `battles` (its `captured_battles` sums to 29,807 against 13,066
and is a different grain); `trophy_delta` from `trophy_change_total`.
Because the rollup is derived from battles and the 2026-09-15 replay
already regrouped the v4 battle facts from 2026-01-03, most of these
(player, day, mode, game mode) keys already exist; the op **inserts only
keys the record lacks** (`on conflict do nothing`) and reports how many
it added, so the "only surviving record of that quarter" is measured, not
assumed. This is a direct row insert by exception, on a derived table,
under a `source`-less schema; the op's log line and this document are
its provenance.

Not imported: `war_attendance_days` (the record has `war_attendance_day`
from the replayed `currentriverrace` reads since March, resolved by
range) and `pol_season_results` (2.1: the archive's
`lastPathOfLegendSeasonResult` on every profile of the following month
is the API's own copy of the same fact; the census compares the bot's
189 rows against `player_pol_season` after Phase 2).

### 6.4 The validation census, `{series_census: {clan_tag, from, to}}`

Read-only. Over every game day in the window, for the clan row and each
member row, the op reports what the recorder captured for itself against
what the bot held, before any import row is committed (the import is run
into a staging schema first; the census joins staging to live):

- days only the recorder has, only the bot has, both;
- per metric (`trophies`, `donations`, `donations_received`,
  `clan_rank`, `clan_score`, `clan_war_trophies`, `members`,
  `donations_per_week`): rows equal, rows within the residual (the
  recorder's `observed_at` later than the bot's), rows that disagree
  otherwise, and the distribution of `observed_at` deltas;
- Sundays: `pre_reset` rows equal to the bot's MAX, and how many the
  recorder's own pre-reset window missed;
- the rollup slice: keys added, keys already present and equal, keys
  present and different.

Expected on a clean model: every disagreement explained by the five-hour
residual or a missing poll. Anything else is a defect in the mapping or
the projector, found before the import lands. The census output goes in
the Phase 3 NOTES entry as the numbers.

---

## Part 7: the readers

All under the tool conventions (ENGINEERING "Tool conventions"):
`WINDOW_ARGS` with `days` / `weeks`, one `applied` block with
`window {from, to, source, timezone, season, crosses, season_age_days}`
from `resolveSeasonWindow`, `verbosity: full | compact`, `notes[]`,
`docs`, an `outputSchema` in `output-schemas.mjs`, groups that exist.
Contract changes are minor with a `CHANGELOG` entry, a What's-new entry
and the site docs in the same commit.

**Docs first** (every pointer must resolve): a `clocks.md` H2 **The game
day** (the function, the same partition as the policy day, what the
series rows' `day` means, timezone as display) and a `recording.md` H2
**Daily series** (which tables, from when, the kinds, `source`, the
last-of-day rule, the roster-vs-profile answer to "trophies on day D").
`docsRef("clocks", "the-game-day")` and
`docsRef("recording", "daily-series")` are the two pointers.

### 7.1 `players_timeline` (minor)

- `metrics` grows to every snapshot metric: `trophies`, `best_trophies`,
  `donations`, `donations_received`, `battle_count`, `wins`, `losses`,
  `three_crown_wins`, `star_points`, `exp_points`, `collection_level`,
  `king_tower_level`, `pol_league`, `pol_trophies`, `pol_rank`,
  `season_trophies`, `season_best_trophies`, `total_donations`,
  `challenge_cards_won`, `challenge_max_wins`, `tournament_cards_won`,
  `tournament_battle_count`, `arena_id`, `clan_tag`, `clan_rank`,
  `previous_clan_rank`, `game_last_seen_at`.
- Every metric comes from the one row. A day the roster wrote and no
  profile poll did carries the roster's columns and nulls elsewhere; each
  point carries `profile_observed_at` (null on such a day) so a consumer
  can tell a roster-only day from a stale profile, and a note says so
  once. `clan_tag`, `clan_rank`, `previous_clan_rank` and
  `game_last_seen_at` join the metric set. This is the arena-latency fix
  at read time and the presence series in the same series as everything
  else.
- `progress_key` (optional, one of `mode_season` or `'all'`) adds
  `progress[]`: `{key, mode, season_month, day, trophies,
  best_trophies, arena_id}` from `player_progress_daily`.
- `kind: daily | pre_reset | season_roll` (default `daily`) selects the
  row kind; the weekly `pre_reset` series is the donations question the
  docs already answer in a note.
- `applied.window` gains the season fields; the "Snapshot days are UTC
  dates" note becomes the game-day note; `snapshots_available_from` stays.

### 7.2 `clans_timeline` (new, group Clans, minor)

Defaults `clan_tag` to the recorded clan (`entitledClan()`). Metrics
(all by default): `clan_score`, `clan_war_trophies`, `members`,
`donations_per_week`, `required_trophies`, and the roster aggregates
computed at read from the snapshot rows carrying the clan's tag that
day: `total_member_trophies`, `avg_member_trophies`, `members_seen` (how
many member rows the day has, so a partial day reads as partial). `granularity: day | week` as
`players_timeline`; `kind` as above; `verbosity: compact` keeps `day` and
the five clan metrics. Response: `clan_tag`, `applied`,
`series_available_from`, `series[]`, `notes` (the game day; `source:
elixir-bot` days named when any are in the window; the 07-03 kind of
hole named), `docs`, `meta`. Plan and cost: Appendix A, one index range
on the clan table plus one bitmap scan on the snapshot's clan-day index,
~240 buffers cold.

### 7.3 `clans_members_timeline` (new, group Clans, minor)

The member series on the same shape, scoped by clan, read from
`player_snapshot_daily` by `clan_tag`: `clan_tag` (default the recorded
clan), `player_tags` (optional subset; every player the roster placed in
the clan in the window otherwise), `metrics` from the roster set
(`trophies`, `donations`, `donations_received`, `clan_rank`,
`previous_clan_rank`, `arena_id`, `game_last_seen_at`) and, for members
whose profile is recorded, any profile metric of 7.1, window, `kind`,
`granularity`; `limit` on members with a `maximum`; `verbosity: compact`
returns per member the first and last point and the delta only. Names
from `player` at read (the label is current everywhere else). Response
capped by the protocol layer's `result_too_large` like every list.

### 7.4 `rankings_timeline` (patch)

The description says "the season story at hourly resolution" and the
`limit` description says "the global board is ~24 a day"; the global
board has been daily since 0075 (2026-09-11), and snapshots exist only
when the board changed. New text: "one snapshot a day since 2026-09-11
(hourly before, for the global board), and only when the board moved; a
flat stretch is confirmed, not repeated". A description change moves the
tools fingerprint, so it is a patch bump with a changelog line.

### 7.5 What the site's build needs beyond these

- **Roster with member fields in one call.** `clans_roster` full
  verbosity today gives roles, latest trophies and donations, activity
  recency; the site also renders per member `best_trophies`,
  `battle_wins`, `battle_count`, `three_crown_wins`, `account_age_days` /
  years, `collection_level`, `clan_war_wins` (`warDayWins`),
  `total_clan_donations` (`totalDonations`) and `badge_count`. Proposed
  (minor): `clans_roster` full verbosity carries each member's latest
  snapshot lifetime block plus `years_played` / `account_age_days` and a
  badge count, from the tables Part 4 fills. Without it the site needs 46
  `players_profile` calls a day, which is the CR API build in MCP
  clothing.
- **War weeks.** `war_history` (rank, fame, trophy change, colosseum,
  per member decks and points) covers `river_race_weeks` and
  `river_race_participants`; `war_rivals` covers `river_race_standings`.
  Nothing new.
- **The summed member trophies** are `clans_timeline.total_member_trophies`
  and its latest point; `open_slots` is `50 - members` at the site.
- **Averages the trends page draws** (`averageWins`, `averageYearsPlayed`,
  `averageCollectionLevel`, the 12k+/14k+/6-years+/1000+ counts) are
  profile-derived per day and are not in the clan series by decision 5
  (no card- or badge-level snapshots; these are lifetime counters). With
  the roster and the profile on one row they are the same aggregate
  `clans_timeline` already runs, over the profile columns of the day's
  member rows (`avg(wins)`, `avg(collection_level)`, the counts; null on
  a member with no recorded profile, which the day's `members_seen`
  against the count of non-null values exposes). They are metrics
  (`avg_member_wins`, `avg_member_collection_level`,
  `members_12000_plus`, `members_14000_plus`, `members_6_years_plus`,
  `members_collection_1000_plus`), selectable in `metrics` and off by
  default; never an `include_*` flag, which the conventions ban.

---

## Part 8: cost and risk

| Item                               | Cost                                                                                                       | Risk and its guard                                                                                                                                            |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migrations 0126–0130 (Part 4 DDL)  | instant: new tables, nullable columns, one function                                                        | none; expand only                                                                                                                                             |
| Roster projector writes            | +2 statements per poll, ≤51 rows; ~4,500 HOT updates a day per active tracked clan (1,100 with the hour rule) | churn on `player_snapshot_daily`, four times its current rate for a tracked clan's members; HOT, no index moves; autovacuum already covers the participant table's far larger churn |
| Profile projector writes           | +3 statements, ≤4 rows                                                                                     | the `""` key needs `mode_season` to accept it (one row); `parseProgressKey` change is a one-line test                                                         |
| `player_snapshot_daily` re-key     | one batched op, ~16k rows, ~30 s; a census first                                                           | rows dropped on collision are the rule's own semantics; count reported before; RDS snapshot first as on 2026-09-15                                             |
| Series backfill                    | ~1.7 h of migrate Lambda in 240 s slices; ~74k S3 GETs (~$0.03)                                            | reserved concurrency 1 blocks deploys while it runs: drive to completion first; cursor resumable; observed_at guard makes reruns idempotent                    |
| elixir-bot import                  | 5,488 payload replay (~8 min) + a few hundred series rows + ≤2,371 rollup keys                             | the census runs on staging before commit; `source` column names every imported row forever; bot untouched                                                     |
| Contract                           | two minors (players_timeline + clans_timeline/clans_members_timeline; clans_roster block), one patch       | additive only; docs sections added before pointers                                                                                                            |
| Storage                            | ~2.5 GB a year, 2.3 GB of it the roster rows on `player_snapshot_daily` (4.5) | 20 GB volume, 4.1 GB used, auto-scales to 100; the rate is measured a month after Phase 1 and recorded in NOTES |
| Unknown-key alarm                  | a key walk per admission; one EMF metric; one alarm                                                        | a noisy first day if the manifest is incomplete: the manifest is written from Appendix D, so the first alarm is a real addition                                |

---

## Sequenced plan

Each phase is its own session, gated by Jamie; "needs from Jamie" is the
manual or decision content, nothing else is blocked.

| Phase | Change                                                                                                                                                                                                                                                                                                                                                                                                            | Kind                                                              | Contract                                    | Needs from Jamie                                                                                                                                                                                                                                                                                                                       |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `game_day()`; the `{snapshot_day_census}` then `{snapshot_rekey}` op moving `player_snapshot_daily` to the game day; the roster columns, `profile_observed_at`, `source` and the clan-day index on `player_snapshot_daily`; `clan_snapshot_daily`, `player_progress_daily`; the state and lifetime columns, `player_pol_season`, `war_period_log`, the `battle` columns, `series_backfill_state`; the projectors split into a series half and writing live (roster, profile, race); `mode_season` admits `""`; the key manifest + `UnknownPayloadKeys` metric and alarm; ENGINEERING rule 2.7; the `expLevel` / clan-chest / `state` / streak reasons written on the projectors | 5 instant migrations + one ~30 s op + code                        | none (tables only; `battles_query` columns wait for 2b) | **Go**, and decision 4 of "Read this first" (1 to 3 are taken); an RDS snapshot before the re-key op (Jamie runs `deploy` with `AWS_PROFILE=jamie`) |
| 2     | `{series_backfill}` clan lane then player lane, driven to completion by the local loop; then the `battle` columns' fill from the battlelog receipts (2b); `{deck_census}`-style `{series_census_self}` proving every admitted roster receipt since 2026-03-12 has its day row                                                                                                                                       | two batched ops, ~1.7 h + ~1.5 h, no deploy in between            | none                                        | **Go**; a window when no deploy is needed (the migrate Lambda is held); nothing manual                                                                                                                                                                                                                                                  |
| 3     | `elixir-bot-series-export.mjs` (read-only); `{replay}` of the bot's 5,488 profile payloads 07-15 → 09-03 under the backfill gateway; `{series_import}` into staging; `{series_census}`; commit of the non-overlapping rows and the rollup keys; the census numbers in NOTES; revoke the gateway row                                                                                                                | one replay (~8 min) + one op + one read-only census               | none                                        | **Go**; the bot stays untouched (decision 3); **revoke** the new `backfill-elixir-bot` gateway row in Admin afterwards, as on 09-15                                                                                                                                                                                                     |
| 4     | Docs sections (`clocks#the-game-day`, `recording#daily-series`); `players_timeline` extended; `clans_timeline` and `clans_members_timeline` with output schemas; `clans_roster` lifetime block; `rankings_timeline` description; changelog, What's-new, tools reference regenerated                                                                                                                                | code                                                              | **minor** ×2, patch ×1, folded into one minor bump (3.12.0) | **Go**; a read of the tool names (`clans_members_timeline` or a better noun)                                                                                                                                                                                                                                                            |
| 5     | poapkings.com onto Elixir: the build script becomes an MCP client on a clan token, sources clan series, member series, roster and war weeks from the four tools, retires `update-roster.js`'s CR calls, `backfill-cr-history.js` and `data/clash-royale.sqlite`; `OPERATOR.md` rewritten for the new probe/refresh; the dead `auto-update.sh` crontab line removed or repointed; the recognition import (elixir-bot, read-only) unchanged | its own repo, its own lease (the domain lease, `../AGENT-TEAM`)   | none here                                   | **The token** (a clan MCP token for POAP KINGS, preferred; an integration token as the fallback), issued by Jamie; the crontab is on Jamie's host                                                                                                                                                                                       |

Tier 2, not in the five phases, in the order they earn their place:
`player_daily_battle_rollup` onto the game day (3.3); the duel round
rows and `used` flag, `global_rank` (2.4); `player_achievement` and the
`badge` catalog (2.1); a `location` catalog (2.2); `war_week_clan`'s
rival columns (2.3).

---

## Tier 1, most important first

1. **Make omission a recorded decision and addition an alarm** (2.7):
   the key manifest per projector, the fixture test, the
   `UnknownPayloadKeys` metric and alarm. Everything else in this review
   is a consequence of this rule not having existed; without it the next
   field the API adds (as `kingTowerLevel` did on 2026-09-02) waits for
   the next review.
2. **The roster writes what it already knows** (4.1, 4.2): the
   recorder's most frequent poll keeps seven clan fields on a clan row
   and seven player fields on the players' own snapshot rows, including
   the arena at the 15-minute cadence and the presence series;
   backfillable to 2026-03-12 for POAP KINGS from the archive. The same
   principle, applied to the race poll and the war log, fills the rivals'
   rows and the missed attendance day (2.3).
3. **One day definition** (3.1, 3.2): `game_day()` and
   `player_snapshot_daily` re-keyed onto it before the new tables land,
   so a season roll, a war day and a series row never straddle.
4. **The progress series** (4.3) with the zero-bucket rule, and the
   profile's dropped lifetime and state fields (1.3, 2.1), `kingTowerLevel`
   and `lastPathOfLegendSeasonResult` above all.
5. **The receipt-ordered backfill** (Part 5) and the elixir-bot replay of
   the 51-day profile hole (6.1): the archive is the source; the bot is
   the check.
6. **The three readers** (7.1–7.3) and the `clans_roster` lifetime block,
   which together are what lets poapkings.com stop calling the CR API.

---

## Appendix A: scratch measurements (2026-09-17)

Two builds of `elixir_ts_scratch`, 125 migrations each, then the
candidate DDL of Part 4 (`DDL-OK` both times: the first build carried a
separate member table, the second the revised shape with the roster
columns on `player_snapshot_daily`). Synthetic fills, then
`vacuum analyze`:

| Table                                              | Rows      | Heap   | Indexes | Total  | Bytes/row |
| -------------------------------------------------- | --------- | ------ | ------- | ------ | --------- |
| `player_snapshot_daily`, 725 members × 365 game days, 235 of them with the profile columns filled | 264,625 | 38 MB | 27 MB | 65 MB | 258 |
| `clan_snapshot_daily`, 18 × 365                    | 6,570     | 704 kB | 368 kB  | 1.1 MB | 173       |
| `player_progress_daily`, 1,734 × 3 keys × 365     | 1,898,730 | 183 MB | 196 MB  | 379 MB | 209       |

Write guards, the roster's partial upsert for one player on a fresh day
key, five polls in sequence: first poll of the day → 1 row written; the
identical payload fifteen minutes later → 0; trophies moved → 1; an
older observation replayed out of order → 0; then a same-day profile
write (`wins`, `profile_observed_at`) followed by a roster poll with
trophies moved → 1, and the row reads trophies 6,060, wins 12,345,
`observed_at` 19:30Z, `profile_observed_at` 19:00Z: the roster moved its
columns and left the profile's alone.

Plans (`explain (analyze, buffers)`, cold cache):

- `clans_timeline` shape, 160 days with the three roster aggregates per
  day: bitmap scan on `player_snapshot_daily_clan_day` (7,520 rows),
  236 buffers, plus the 160-row range on `clan_snapshot_daily_pkey`
  (5 buffers).
- member series, one player, 180 days: index scan on
  `player_snapshot_daily_pkey`, 180 rows, 190 buffers.
- progress series, one player, all keys, 180 days: index scan on
  `player_progress_daily_pkey`, 540 rows, 170 buffers.

`game_day()` checks as in 3.1. The database was dropped afterwards.

## Appendix B: archive census (2026-09-17, `ListObjectsV2` by prefix)

Counts and spans only; no object was read. POAP KINGS rosters by month
(days with ≥1 object / objects): 2026-03 20/20, 04 30/30, 05 31/834,
06 30/1,392, 07 30/3,318, 08 31/3,915, 09 17/1,272; total 189 days,
10,781 objects, 28,124,640 bytes gz; the only missing day 2026-07-03.
King Thing's profile: 1,037 objects on 132 days, 03-07 → 09-17, mean
11,721 bytes gz; missing 05-04 → 05-14 and 07-14 → 09-02. A member whose
profile recording began on 09-08 (`VJQV8G8RL`): 21 objects on 10 days,
no gaps. Bucket totals: 60,299 objects on 09-13, 104,444 on 09-14 (the
elixir-bot replays), 114,076 on 09-15 at 1.03 GB.

## Appendix C: elixir-bot census (read-only, 2026-09-17)

`player_daily_metrics`: 8,684 rows, 144 players, 195 distinct days
03-07 → 09-17 (22 players on 03-07, 51 on the busiest days); donations
by weekday (Sunday = 0) average 80, 32, 58, 83, 110, 137, 164: the
weekly counter climbs to Saturday and the Sunday row already carries the
post-reset average in a MAX-merged column, so the pre-reset peak is in
Saturday's and Sunday's rows both. `clan_daily_metrics`: 191 rows,
`observed_at` 2026-03-12T02:21:45 → 2026-09-17T17:17:54Z; hour
distribution 04:50 ×20, 04:07 ×18, 17:00 ×11, 04:59 ×11, 04:56 ×11.
`player_daily_battle_rollups`: 13,159 rows; mode groups friendly 590,
ladder 4,164, other 772, ranked 1,091, special_event 2,431, tournament
19, two_v_two 506, war 3,586; the ≤ 04-17 slice 2,371 rows / 83 players /
13,066 battles, with `captured_battles` 29,807 and 1,599 rows where the
two differ. `war_attendance_days` 2,641 rows S133–S136 from
2026-06-08T10:00Z. `pol_season_results` 189 rows, seasons 2026-06,
2026-07, 2026-08. `raw_api_payloads`: player 6,929 (07-15 →), clan
7,988, currentriverrace 1,475, battlelog 8,069; 5,488 player payloads on
51 days for 75 players inside 07-13 → 09-04.

## Appendix D: live key sets (2026-09-17, `npm run cr`, keys only)

- `/players/{tag}` top: achievements, arena, badges, battleCount,
  bestPathOfLegendSeasonResult, bestTrophies, cards, challengeCardsWon,
  challengeMaxWins, clan, clanCardsCollected, collectionLevel,
  currentDeck, currentDeckSupportCards, currentFavouriteCard,
  currentPathOfLegendSeasonResult, currentWinLoseStreak, donations,
  donationsReceived, expLevel, expPoints, kingTowerLevel,
  lastPathOfLegendSeasonResult, legacyTrophyRoadHighScore, losses, name,
  progress, role, starPoints, supportCards, tag, threeCrownWins,
  totalDonations, totalExpPoints, tournamentBattleCount,
  tournamentCardsWon, trophies, warDayWins, wins. `badges[]` (79: 76 with
  level, 3 without): iconUrls, level, maxLevel, name, progress, target.
  `achievements[]` (12): completionInfo, info, name, stars, target, value.
  `progress` keys: `""`, `2v2League_202609`, `AutoChess_2026_Season_11`,
  `seasonal-trophy-road-202609`; values: arena, bestTrophies, trophies.
- `/clans/{tag}` top: badgeId, clanChestLevel, clanChestMaxLevel,
  clanChestStatus, clanScore, clanWarTrophies, description,
  donationsPerWeek, location {id, isCountry, name}, memberList, members,
  name, requiredTrophies, tag, type. `memberList[]` (46): arena,
  clanChestPoints, clanRank, donations, donationsReceived, expLevel,
  lastSeen, name, previousClanRank, role, tag, trophies.
- `/currentriverrace` top: clan, clans, periodIndex, periodLogs,
  periodType, sectionIndex, state. `clan`/`clans[]`: badgeId, clanScore,
  fame, name, participants, periodPoints, repairPoints, tag;
  participants[]: boatAttacks, decksUsed, decksUsedToday, fame, name,
  repairPoints, tag. `periodLogs[]` (4): items, periodIndex; items[]:
  clan, endOfDayRank, numOfDefensesRemaining, pointsEarned,
  progressEarned, progressEarnedFromDefenses, progressEndOfDay,
  progressStartOfDay.
- `/riverracelog` items[]: createdDate, seasonId, sectionIndex,
  standings; standings[]: clan, rank, trophyChange; clan: badgeId,
  clanScore, fame, finishTime, name, participants, periodPoints,
  repairPoints, tag; participants as the live race.
- `/cards` items[] (123): elixirCost, iconUrls, id, maxEvolutionLevel,
  maxLevel, name, rarity; supportItems[] (4) without elixirCost and
  maxEvolutionLevel.
- `/leaderboards` items[] (30): id, name. `/events` (8): description,
  eventTag, title. `/locations/{id}/rankings/clans` items[]: badgeId,
  clanScore, location, members, name, previousRank, rank, tag.
  `/locations/global/pathoflegend/players` items[]: eloRating, expLevel,
  name, rank, tag.
- `/players/{tag}/battlelog` (30 entries) battle keys: arena, battleTime,
  deckSelection, eventTag, gameMode, isHostedMatch, isLadderTournament,
  leagueNumber, opponent, team, type; participant keys: cards, clan,
  crowns, elixirLeaked, globalRank, kingTowerHitPoints, name,
  princessTowersHitPoints, rounds, startingTrophies, supportCards, tag,
  trophyChange; card keys: elixirCost, evolutionLevel, iconUrls, id,
  level, maxEvolutionLevel, maxLevel, name, rarity, starLevel. No
  `boatBattle*`, `modifiers`, `tournamentTag`, `challengeId` or
  `*TowersDestroyed` in this log; they are documented from earlier
  captures.
