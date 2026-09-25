# Review 2026-09-19: the Elixir MCP interface after the record redesign

**Outcome (2026-09-25):** executed in six phases on 2026-09-19, contracts
3.14.0 through 4.0.0 (the batched major, with no deprecation window), and
closed that day; the per-phase record is in `docs/notes/2026-W38.md`
("Interface review, Phase 1" to "Phase 6", then the close-out). The
execution brief it names was deleted as spent on 2026-09-25 (git history
keeps it).

Written 2026-09-18 (evening) against `docs/reviews/2026-09-18-INTERFACE-REVIEW-BRIEF.md`,
contract **3.13.0**, commit `d0da6ed` (main, clean tree plus the brief). The
question: after cards became rows (0091-0100), the profile and roster JSON
became columns (0123-0125), the daily series arrived on the game day
(0126-0134), the payload manifest became authoritative (0132) and 3.13.0
ratified "the control next to the number", does the interface still present
one cohesive record to an agent, or a 1.0.0 surface with 3.12/3.13 annexes?
Five investigations follow: what is collected but not served; whether the
words mean the things; eight agent journeys and the seam; the 3.13.0
principle applied to every aggregate; and cohesion. **Recommendations only.
Nothing here is applied.** The execution plan was
`docs/reviews/2026-09-19-INTERFACE-EXECUTION-BRIEF.md` (deleted 2026-09-25).

**Method.** Read in the brief's order: `AGENTS.md`, `docs/ENGINEERING.md`
("Tool conventions" is the baseline reviewed against), `docs/NOTES.md`
2026-09-15 onward (every decision there is context, not a finding), the
2026-09-10 seam review, the docs gap, the schema and time-series reviews and
their execution briefs, `CONSUMER-SURFACES.md`, `META-INTEL.md`, the
`mcp-tool-review` skill; then the contract package, `tools/shared.mjs`,
`controls.mjs`, every tool module, `output-schemas.mjs`, `protocol.mjs`,
`invoker.mjs`, `resources.mjs`, `identity.mjs`, `payload-keys.mjs`,
migrations 0091-0134, the docs corpus (`apps/site/src/docs/*.md`), and the
four first-party consumers. Measured: the exact `tools/list` per principal
kind (`declarations(null|"agent"|"integration")`, identical: 55 tools,
131,200 bytes) through the skill's census script; `{audit_census: {days: 14}}`
and `{args_census: {days: 14}}` on the migrate Lambda (2026-09-04 14:2xZ to
2026-09-18 14:2xZ, which spans the redesign; where a number is on one side of
it, the text says so); every captured call for 2026-09-17 and 2026-09-18
(1,712 objects, `s3://elixir-mcp-archive-999153317627/calls/dt=…`); the
CloudWatch log of the MCP Lambda around one failure. Called live, read-only,
as King Thing over the connected `elixir-mcp` server: 41 tool calls across
33 tools, including every 3.12/3.13 tool, two schema-legal bad inputs and one
request that overflowed the cap. Not done this session: the door probe as the
Discord agent principal (`initialize`, `resources/*`, `prompts/*` by curl),
which the session's tool policy refused as credential exploration; the
agent-kind `initialize` text was read from `protocol.mjs` and from the
connected POAP KINGS agent connector's instructions instead, and the
resources and prompts from `resources.mjs`. Two mechanical sweeps were
delegated and every claim carried from them was spot-checked in the source
before it was written here.

---

## The one-paragraph verdict

The interface is one product at the seam the 1.0.0 review built (windows,
`applied`, `notes`, `docs`, the error set, groups, annotations all hold and
the registry test enforces most of them) and an annex everywhere the
redesign touched the record. The three series tools carry stamps, kinds and a
game-day grain that no battle tool knows; the battle row's 0131 facts, the
war day log, the Path of Legends season finals and the rivals' scores are
collected under the manifest and unreachable through any tool (33 of 165
landing columns, two whole tables); the same lifetime block is camelCase on
one tool and snake_case on two; `arena` is a name on one row and an id on
the next; `next_war_day_opens_at` means two things on two tools; and the
3.13.0 principle stops at the five tools it shipped on, so `clans_standings`,
`players_summary`, `battles_trends` and the corpus meta tools still serve a
pooled win rate with no mode split beside it. Fourteen verified defects, one
of which is a 25-second Lambda timeout on `war_history`'s exact-week roster
path that reaches the client as a bare HTTP 500 with no request id. None of
it is breaking to fix: every recommendation below is a field beside an old
one, a note that fires on a confound, a docs sentence, or a rename batched
for a major with a window.

---

## Verified defects (fix without a decision)

Each carries the file:line or the live request that proves it. Live ids are
`meta.request_id` values from 2026-09-18 14:2x-14:3xZ, all read-only.

1. **`war_history` with `season_id` + `section_index` and no `player_tag`
   times out the Lambda and reaches the client as HTTP 500.** The path drops
   the `limit 40` (`services/mcp/src/tools/war.mjs:648`) and runs the
   `warBattlesSql` week scan twice per participant row (`war.mjs:614-637`);
   the tool is not in the invoker's query-budget set (`invoker.mjs:350-352`
   names three tools), so nothing cancels it. Live: request
   `5a31b8f9-67cf-401e-b03d-d14ed3fce20d`, `REPORT … Duration: 25000.00 ms
   … Status: timeout` in `/aws/lambda/elixir-mcp-mcp` at 14:27:4xZ; the
   client saw `Internal Server Error`, no body, no request id, no audit row,
   no capture. The same week with `player_tag` answers in 70 ms
   (`52c512c2`). The one-call closed-week roster path `battles.md` advertises
   ("Supply `season_id` and `section_index` together…") is therefore
   unusable for a 46-member clan.
2. **`war_current.next_war_day_opens_at` is `null` on every war day;
   `game_clock.next_war_day_opens_at` is an instant at the same moment.**
   `services/mcp/src/war-period.mjs:40-43` sets it only on training days;
   `services/ingest/src/game-clock.mjs:35-47,70` defines it as "the next war
   day to open after this one". Live at 14:26Z, war day 2: `game_clock` →
   `2026-09-19T10:00:00Z` (`0b6cfec0`), `war_current` → `null` at top level
   and in `period` (`967e09d6`); the captured `war_current` calls of
   2026-09-17 show the same on war day 1. One name, two meanings, on the two
   tools the docs tell a routine to schedule from.
3. **`war_history.history_starts_at` is the oldest row of the requested
   window, not the recording horizon.** `war.mjs:694-701` takes
   `weeks[weeks.length - 1]`; the note (`war.mjs:718`) and `battles.md:251`
   call it "the recording horizon: fewer seasons than requested is coverage,
   not absence". Live: `seasons: 1` answers `{136, 0}` (`cd752102`) while
   `clans_participation` in the same minute lists S134 section 2 for the
   same clan (`deda3eec`).
4. **`battles.md` says a battle's `arena` is "the arena id the battle was
   fought in"; the wire serves the name.** `apps/site/src/docs/battles.md`,
   table row `arena`; `tools/battles.mjs:361,448` selects and serves
   `b.arena` (text). Live `87c81990`: `"arena":"Ultimate Clash Pit"`. The id
   column exists since 0131 on every row (backfilled, Phase 2) and is not
   selected.
5. **The `initialize` instructions name three `applied.window.source`
   values; the contract has five.** `protocol.mjs:80-82` says "source
   argument, default or unbounded"; `output-schemas.mjs:48-50` and
   `clocks.md` list `argument | default | unbounded | fixed | season`, and
   the meta tools answer `season` by default since 3.10.0.
6. **`clans_standings` notes state a `percentile` formula for a field the
   response does not carry.** `tools/clans.mjs:144` ("percentile = 1 -
   (rank-1)/ranked_members") against the member shape at `clans.mjs:95-111`;
   live `2fdac89d` has `rank` and no `percentile`. elixir-bot re-implements
   it (`../elixir-bot/capabilities/mcp_stats.py:160`).
7. **The lifetime block is camelCase on `players_profile` and snake_case on
   `clans_roster` and `players_timeline`.** `players_profile` →
   `snapshot.lifetime.{battleCount, wins, losses, threeCrownWins,
   starPoints, expPoints, collectionLevel}` (`snapshot-columns.mjs:113-125`;
   live `75c671e9`); `clans_roster` → `lifetime.{battle_count, wins,
   losses, three_crown_wins, collection_level, king_tower_level,
   total_donations}` (`clans.mjs:437-446`; live `8b5070bd`);
   `players_timeline` metrics `battle_count`, `collection_level`
   (`daily-series.mjs:28-34`). clan.poapkings.com reads the camelCase form
   (`services/api/src/manage/scout.mjs:112-115`) and would read null from the
   other two.
8. **`live_pending` carries `retry_after_s` only inside the English
   hint.** `tools/shared.mjs:511-516` (`notRecordedOrPending`) and
   `tools/live.mjs:63-67` put the seconds in `hint: "Call again in N s."`;
   the successful path carries `live_status.retry_after_s` as a field.
   clan.poapkings.com regexes digits out of the hint
   (`services/api/src/manage/scout.mjs:56-59`) and elsewhere reads
   `error.retry_after_s`, which does not exist, so it always waits 30 s
   (`manage/recruit.mjs:37`).
9. **`clans_timeline`'s `members_seen` note gives the wrong reading on the
   days it matters.** The note (`tools/series.mjs:198-200`) says a day where
   `members_seen` reads *below* `members` is partial. Live `05427edd`:
   2026-09-10 `members: 46, members_seen: 49`; 09-16 and 09-17 `46` vs `47`.
   The excess is members who left that day and whose row still carries the
   clan's tag (the "last roster placed them" rule); the note does not say
   so, and nothing does.
10. **`players_timeline` serves `collection_level: 0` on days whose payload
    carried no collection level, where the docs promise `null` for an
    omitted key.** Live `34d6747c` (King Thing, weekly, 6 weeks):
    `collection_level 0` on 2026-08-09, 08-16, 08-23, 08-30 and `1754` from
    09-06; the August rows are the bot-replayed profile days (NOTES
    2026-09-18, Phase 3). `snapshot-columns.mjs:12,28` maps an absent key to
    `null`, so the zeros entered through the 0123 fill from the old JSON
    (`0123_json_to_columns.sql:55`) or the replayed payloads. An agent
    reading the series sees a player go from level 0 to 1,754 in a week.
    `{snapshot_day_census}`-style read: count rows with
    `collection_level = 0 and profile_observed_at is not null` per source.
11. **`elixir_coverage.completeness_last_7_days.average_ratio` is a
    string.** `coverage.mjs:99` renders `"1.000"`; `output-schemas.mjs:917`
    declares `["string", "null"]`; live `864110e4`. Every other rate on the
    surface is a number (`win_rate`, `ratio` on the intervals of the same
    response).
12. **Six descriptions exceed the 600-character convention and the registry
    test allows 1,000.** ENGINEERING "Tool conventions": "Description at
    most 600 characters"; `services/mcp/test/tool-conventions.test.mjs:99-108`
    asserts `<= 1000`. Census: `elixir_timeline` 939, `players_timeline` 714,
    `clans_roster` 714, `war_current` 620, `clans_participation` 618,
    `battles_query` 610 (mean 425).
13. **`meta.completeness_note` is promised on every seam and set by
    nothing.** The `initialize` instructions (`protocol.mjs:86-87`),
    `responses.md` ("present only when capture is known to be incomplete"),
    `choosing-a-tool.md` and the discord prompt all route an agent to it;
    `grep completeness_note services/mcp/src` finds only the instruction
    string. `buildMeta` (`shared.mjs:600-650`) never sets it. The one
    envelope-level coverage control the docs teach cannot fire.
14. **`rankings_timeline`'s description says "one snapshot a day since
    2026-09-11"; the record holds sixteen on that day.** Live `f41e4ebb`:
    points at 03:09Z, 03:29Z, … 15:37Z on 2026-09-11, then one a day. The
    hourly cadence ended mid-day on 09-11 (0075); the description's date is
    right and its count is not.

Two smaller contradictions ride in Part 2: `game_events.days_seen` are UTC
days while every other daily series is a game day (`rankings.mjs:838`, said
in the note, so an inconsistency rather than a defect), and the manifest
names `battle_participant_card.evolution_level` for a column the DDL spells
`form` (`payload-keys.mjs` vs `0091_deck_cards.sql:67`; the reader serves
it correctly from `pc.form`, `shared.mjs:984,997`).

---

## Part 1: collected but not served (the manifest-to-reader census)

**Method.** Every `to("table.column")` in `services/ingest/src/payload-keys.mjs`
(165 distinct targets) was matched against every SQL reference and
projection under `services/mcp/src/` plus the ingest helpers the tools
import (`recorded-profile.mjs`, `snapshot-columns.mjs`, `game-clock.mjs`,
`war-clock.mjs`, `season.mjs`). Every hit was read in alias context.
Numbers are of the checkout at `d0da6ed`, 2026-09-18.

### 1.1 Totals

| table | served | aggregate-only | unserved | targets |
|---|---|---|---|---|
| arena | 1 | 0 | 0 | 1 |
| battle | 8 | 0 | 8 | 16 |
| battle_participant | 9 | 0 | 0 | 9 |
| battle_participant_card | 4 | 0 | 0 | 4 |
| card | 9 | 0 | 0 | 9 |
| clan | 3 | 0 | 3 | 6 |
| clan_membership | 2 | 0 | 0 | 2 |
| clan_ranking_entry | 8 | 0 | 0 | 8 |
| clan_snapshot_daily | 4 | 0 | 2 | 6 |
| game_event / game_event_day | 4 | 0 | 0 | 4 |
| player | 5 | 0 | 3 | 8 |
| player_badge | 5 | 0 | 0 | 5 |
| player_card | 5 | 0 | 0 | 5 |
| player_pol_season | 0 | 0 | 3 | 3 |
| player_progress_daily | 3 | 0 | 0 | 3 |
| player_snapshot_daily | 37 | 0 | 0 | 37 |
| poll_state | 0 | 0 | 1 | 1 |
| ranking_board / ranking_entry / ranking_snapshot | 9 | 0 | 0 | 9 |
| war_attendance_day | 1 | 0 | 0 | 1 |
| war_participation | 4 | 0 | 1 | 5 |
| war_period_anchor | 0 | 1 | 0 | 1 |
| war_period_log | 0 | 0 | 9 | 9 |
| war_week | 3 | 0 | 1 | 4 |
| war_week_clan | 7 | 0 | 2 | 9 |
| **total** | **131** | **1** | **33** | **165** |

### 1.2 The census in full, by table

Served columns name the reader; unserved columns are bold. Evidence is the
select or projection line.

| table | served (reader) | unserved |
|---|---|---|
| arena | `name` → `battles_performance.trophy_floor.arena`, `battles_levels` filter, timeline text (`controls.mjs:211-220`, `battles.mjs:1791`) | (DDL only) `first_seen_at`, `observed_at` |
| battle | `arena` (name), `arena_id` (only as `trophy_floor.arena.id` and the level curve, `controls.mjs:197`, `level-curve.mjs:30`), `battle_time`, `game_mode_id`, `game_mode_name`, `league_number`, `type` → `battles_query` (`battles.mjs:360-364,444-449`) | **`boat_battle_side`, `deck_selection`, `event_tag`, `is_hosted_match`, `is_ladder_tournament`, `new_towers_destroyed`, `prev_towers_destroyed`, `remaining_towers`, `tournament_tag`** (the 0131 facts; the select omits them all; `arena_id` is not on the row either) |
| battle_participant | all nine → `battles_query` `me`/`opponents` (`battles.mjs:362-364,414-470`) | none |
| battle_participant_card | all four → `deck.cards[]` via `renderDecks` (`shared.mjs:984-998`) | none |
| card | all nine → `cards_catalog`, `players_collection`, deck names (`cards.mjs:58-72`, `players.mjs:501-546`) | none |
| clan | `badge_id`, `clan_tag`, `name` → `players_profile.clan`, `clans_roster` (`players.mjs:261-263`, `clans.mjs:362,417`) | **`description`, `type`, `location_id`** (every clan select is `name` only: `clans.mjs:324,362,504`) |
| clan_membership | `player_tag`, `role` → `clans_roster`, `clans_participation` | none |
| clan_ranking_entry | all eight → `rankings_clan_ladder` (`rankings.mjs:551-569`) | none |
| clan_snapshot_daily | `clan_score`, `clan_war_trophies`, `required_trophies`, `donations_per_week` (+ `members`) → `clans_timeline` (`series.mjs:47-51,155-156,176`) | **`type`, `location_id`**: selected at `series.mjs:156`, absent from `ALL_CLAN_METRICS` (`series.mjs:46-70`), never emitted; (DDL) `receipt_id` |
| game_event / game_event_day | all → `game_events` (`rankings.mjs:798-834`) | none |
| player | `player_tag`, `name`, `last_known_clan_tag`, `last_known_clan_role`, `game_last_seen_at` → `players_profile`, `clans_roster`, `badges_holders` | **`war_day_wins`, `clan_cards_collected`, `legacy_trophy_road_high_score`** (0127; writer only, `ingest/snapshots.mjs:463-469`; `recorded-profile.mjs:6-9` omits them) |
| player_badge | all five (+ `observed_at`) → `players_profile.badges`, `badges_rarity`, `badges_holders` | none |
| player_card | all five (+ `observed_at`) → `players_collection` | (DDL) `first_seen_at` |
| player_pol_season | — | **`league`, `trophies`, `rank`** (+ keys, `observed_at`): the table has no reader at all (`grep player_pol_season services/mcp/src` → 0) |
| player_progress_daily | all → `players_timeline.progress[]` (`players.mjs:405-421`) | none |
| player_snapshot_daily | all 37 (the 0123 columns via `snapshot-columns.mjs:51-131` → `players_profile`; the 0127/0133 columns via `PLAYER_METRICS` and `STAMP_COLUMNS`, `daily-series.mjs:23-51,139` → `players_timeline`, `clans_members_timeline`; a subset → `clans_roster`, `clans.mjs:380-401`) | none |
| poll_state | (read for `endpoint`, `last_admitted_at`) | **`period_type`** (the API's own `periodType`, 0110; no reader) |
| ranking_board / ranking_entry / ranking_snapshot | all → `rankings_players`, `rankings_clans`, `rankings_timeline` | none |
| war_attendance_day | `decks_used_today` → `war_current.decks_today`, `clans_participation`, `war_history.war_days` | none |
| war_participation | `player_tag`, `points`, `decks_used`, `boat_attacks` → `war_current.participants`, `war_history.member_weeks` (`war.mjs:319,628-629`) | **`repair_points`** |
| war_period_anchor | `period_index` read only as the key for `first_observed_at` → `war_current.period.observed_offset_minutes` (`war-period.mjs:54-55`) | — |
| war_period_log | — | **all nine**: `period_index`, `participant_clan_tag`, `points_earned`, `progress_start`, `progress_end`, `progress_earned`, `end_of_day_rank`, `defenses_remaining`, `progress_from_defenses` (0130; 550 rows live for 16 clans, NOTES 2026-09-18; no reader) |
| war_week | `clan_tag`, `season_id`, `section_index` → `war_history`, `war_current` | **`closed_at`** (the API's own `createdDate`, 0105); `war_history.finished` serves `finished_observed_at` instead (`war.mjs:590,684`) |
| war_week_clan | `participant_clan_tag`, `participant_name`, `fame`, `period_points`, `rank`, `trophy_change`, `finish_time` → `war_current.standings`, `war_history`, `war_rivals` | **`clan_score`, `repair_points`** (0127; `war.mjs:311-312` omits both) |

The manifest's `derived(...)` (106 entries) and `dropped(...)` (97 entries)
lists are the ratified Tier 2 and Tier 3 decisions of the time-series review
(2.1-2.5) and the 0094/0112 drops; they name their reasons on the entries and
none of them is a finding here. The `expLevel` retirement, the clan-chest
trio, the achievements, `arena.rawName`, the duel round rows and
`globalRank` stay unrecorded by decision (NOTES 2026-09-17, Phase 1, "Left
out, and why").

### 1.3 The unserved, and what each is for

For each unserved column and each new table: the question an agent asks that
it answers, the natural home, and the cost of not serving it.

| What | The question | Home (additive) | Cost of not serving |
|---|---|---|---|
| `battle.arena_id` on the row | "which arena was this played in" as an id an agent can join to `players_timeline.arena_id`, `battles_levels.arena_id`, `trophy_floor.arena.id` | `battles_query` rows: `arena: {id, name}` beside the string, or `arena_id` beside `arena` (see 2.2) | today the same fact is a string on one tool and an integer on three; a consumer joins by name |
| `battle.event_tag`, `tournament_tag`, `is_ladder_tournament`, `is_hosted_match`, `deck_selection` | "was this a challenge/event battle, which event, was the deck drafted or collection" — the thing `game_events` exists to explain and `battles_query` cannot confirm | `battles_query` rows, one small object `context: {event_tag, tournament_tag, ladder_tournament, hosted, deck_selection}` (full verbosity) | the pairing of a battle with `game_events` is by mode name substring today; a draft-mode deck is indistinguishable from a chosen one in `battles_decks` (a drafted deck has no identity a player will play again) |
| `battle.boat_battle_side`, `new_towers_destroyed`, `prev_towers_destroyed`, `remaining_towers` | "did my boat attack land; how many towers did we take" | `battles_query` rows when `type_class = 'boat'`: `boat: {side, towers_before, towers_after, remaining}` | boat battles are served as a bare `type` with `outcome` and nothing else; the war attack story is not tellable |
| `war_period_log` (9 columns, whole table) | "how did each war day go: points per day, rank at end of day, defenses" — the day-by-day inside a week `war_history` only knows as a final rank | `war_history` when `season_id` + `section_index` are given: `days[]` `{war_day, period_index, standings: [{clan_tag, points_earned, progress_start, progress_end, progress_earned, end_of_day_rank, defenses_remaining, progress_from_defenses}]}`; and the current week's closed days on `war_current` | the "did we win and who carried" journey (3.1, J4) reconstructs the week from `clans_participation`'s positional arrays; the rivals' day-by-day is unknowable |
| `war_week_clan.clan_score`, `repair_points`; `war_participation.repair_points` | "how strong is each clan in the bracket" (clan score is the game's own strength number) and "did repairs cost us" | `war_current.standings[]` and `war_history.member_weeks[]`, the same names | `war_rivals` fingerprints rivals by fame alone; `clan_score` is the number a scout wants first |
| `player_pol_season` (whole table) | "how did my Path of Legends season end" per past season — `players_profile.league_statistics.previousSeason` holds one | `players_profile.path_of_legend.seasons[]` (last N finals: `season_month, league, trophies, rank`), or `players_timeline({ kind: 'season_roll' })` already carries `pol_*` at the roll | 2,177 finals for 1,710 players (NOTES 2026-09-18) unreadable; the series tools carry the state at the roll, so the honest answer is "served only as the roll-hour snapshot" |
| `player.war_day_wins`, `clan_cards_collected`, `legacy_trophy_road_high_score` | "career war day wins" (the profile's `warDayWins` counter), "cards donated to the clan lifetime", "old trophy road best" | `players_profile.attributes` and `clans_roster.lifetime` (the review 7.5 site block already renders `clan_war_wins`) | the 7.5 justification for the lifetime block ("the site rendered these from 46 profile reads a day") named `warDayWins`; it is collected and not in the block |
| `clan.type`, `location_id`, `description`; `clan_snapshot_daily.type`, `location_id` | "is the clan open or invite only; where is it; what does it say about itself" (the join question, J6) | `clans_roster` header: `type, location_id, description`; `clans_timeline` metrics `type`, `location_id` (the enum already excludes them) | the J6 journey cannot answer the first thing a joiner asks; the series select already fetches the columns and drops them |
| `war_week.closed_at` | "when did the week actually close" (the API's own stamp) | `war_history.weeks[].closed_at` beside `finished` (which is the recorder's sighting) | the two are conflated under `finished`; a consumer computing "closed" from `finished_observed_at` inherits polling latency |
| `poll_state.period_type` | "what does the API say today is" (`warDay`, `training`, `colosseum`) beside the grid's `kind` | `war_current.period.api_period_type` | the API's own word for the day is the one disagreement signal the policy grid has; it is recorded and not shown |
| `player_card.first_seen_at`, `arena.first_seen_at/observed_at`, `clan_snapshot_daily.receipt_id` | provenance | none needed now | unserved by decision: keys and receipts are the record's, not the reader's |

**Read-only ops to size each before it ships:** row counts are already in
NOTES (2026-09-18 Phase 2: `war_period_log` 550, `player_pol_season` 2,177,
`clan_score` on 459 `war_week_clan` rows, `repair_points` on 4,785
`war_participation` rows); the battle columns are filled on 256,163 rows.
Nothing here needs a migration; every home is a column already indexed by
the key the tool reads.

---

## Part 2: semantic mismatch

### 2.1 Pre-redesign residue

| Where | Says | Reality |
|---|---|---|
| `battles.md` `arena` row | "the arena id" | the name (defect 4) |
| `rankings.mjs:838` `game_events` note | "days_seen is the UTC days" | true, and the only daily series on UTC days; every other day on the surface is the game day since 0126 |
| `protocol.mjs:80-82` instructions | `source` is "argument, default or unbounded" | five values (defect 5) |
| `methodology.md:101` | "Deck names, forms and tower troops come from each returned deck's latest qualifying observation … only those exemplar payloads are read" | 3.4.0: the identity renders from `deck_card` + catalog by `deckIdentities()` (`shared.mjs:935-970`); there is no exemplar payload any more |
| `tools/players.mjs:279,379` and one captured 09-17 response | `players_timeline` point key `date`; one pre-3.12 note "Snapshot days are UTC dates" was still served on 2026-09-17 (capture `poap-kings-discord`, 1 of 7 calls) | the key is the game day; the new tools say `day`; the note text was replaced in 3.12.0 (the capture predates the deploy at 02:34Z) |
| `war-deck-check.md` (discord routine) | "or the war-day anchor looks stale, post nothing" | 3.11.1 retired the anchor as the day's source (`war.mjs:275-277`); a consumer still teaches the rule |
| `elixir_coverage` | `incomplete_days` always `null`, "deprecated" | a retired field kept on the wire since the 0.x contracts; batch for the major |
| `war_current.nominal_period_elapsed` | always `false` since 3.11.1, "stays on the wire for readers that check it" | same class: a field with one value |
| `activity.md:27` | "One cell per UTC calendar day for the last 365 days" | true (the daily battle rollup stays on the UTC day, time-series review 3.3, Tier 2 by decision); the page does not say the series tools on the same site use a different day |
| `clocks.md` "Windows and timezones" | `days: 7` is "from seven days before now with no `to`" | on the three series tools `days: 7` is seven game days, today included (`daily-series.mjs:98-102`); the page describes only the instant grammar |
| `responses.md:56-60` `timezone_applied` | "Only tools that build the full envelope emit it (the player, battle and war subject tools)" | `clans_standings`, `clans_participation`, `battles_trends` and the series tools emit it too (`clans.mjs:150`, live `2fdac89d`); the sentence is a 0.x boundary |
| `agents.md` `initialize` example | "(47 members) … You already know 9 of them" | illustrative; fine |

### 2.2 One word, several meanings

| Word | Meanings on the surface today | Stated where the agent meets it? | Recommend |
|---|---|---|---|
| `mode` | (a) mode group argument on 11 tools (`MODE_SCHEMA`); (b) `battles_performance({group_by: "mode"})` = per named game mode, not the group (`battles.mjs:594`: "mode: per named game mode"); (c) `game_mode {id, name}` on the battle row; (d) `progress[].mode` on `players_timeline` (the `mode_season` mode) | (a) yes; (b) only in the argument description, contradicting (a) on the same tool; (c) yes; (d) no | now: describe (d); at the major rename `group_by: "mode"` → `"game_mode"` |
| `type` | the API battle type on the row and in `modes` folding; `clan.type` (open/inviteOnly/closed, unserved); `type_class` (pvp/boat, internal) | the row's `type` yes | serve the clan's as `clan_type` when it lands |
| `day` / `date` / `week_of` / `iso_week` / `day_in_week` / `war_day` / `days_seen` | `clans_timeline`, `clans_members_timeline`, `progress[]` say `day` (game day); `players_timeline` says `date` (game day); `battles_performance` weekly and `battles_trends` say `week_of` (ISO Monday, UTC) + `iso_week`; `clans_participation` `weeks[].iso_week/from/to`; `game_events.days_seen` (UTC days); `war_current.period.day_in_week` (0-based) beside `war_day` (1-based) | the series notes say game day; `week_of` is said once on `battles_performance`; `days_seen` says UTC | one point vocabulary (2.4): `day` for a game day, `week_of` for an ISO Monday, `month` for a calendar month; `date` deprecated beside `day` at the major |
| `n` | `battles_levels.player.n` and `monthly_trend[].n` (the scored player's battles, once); a curve bin's `n` (both sides) | yes since 3.13.0 (`methodology.n`) | none |
| `points` / `fame` / `period_points` / `war_points` / `clan_score` / `repair_points` | `war_current.participants[].points` (member contribution), `standings[].fame` (boat), `period_points` (today's clan score), `clans_participation.war_points` (same as `points`), `war_week_clan.clan_score` (unserved: the clan's strength score), `repair_points` (unserved) | `points` vs `fame` yes (note on three tools); `war_points` = `points` is not said | rename nothing; say "war_points is participants[].points per war week" on `clans_participation`; serve `clan_score` under that name |
| `trophies` | Trophy Road trophies (`trophies`), `best_trophies`, `season_trophies` (the seasonal road), `pol_trophies` (Path of Legends standing, which `rankings_*` calls `rating`), `progress[].trophies` (side modes), `clan_war_trophies`, `required_trophies`, `trophy_change`, `trophy_battles`, `trophy_net`/`net_trophies` (two spellings of one quantity: `clans_standings.trophy_net`, `battles_performance.net_trophies`) | the glossary defines PoL vs Trophy Road; `pol_trophies` vs `rating` is nowhere | now: a glossary entry "the four trophy kinds" and one sentence on `rankings_players` that `rating` is the profile's `pol_trophies`; major: `trophy_net` → `net_trophies` |
| `observed_at` and friends | `observed_at` (a point's newest observation), `profile_observed_at`, `roster_observed_at`, `source_observed_at`, `started_observed_at`, `finished_observed_at`, `joined_observed_at`, `first_observed_in_clan`, `last_seen_in_game`, `game_last_seen_at` (the same game fact under two names on `clans_roster` vs `players_timeline`), `lifetime.as_of` (= `profile_observed_at`), `trophies_as_of` (a date), `meta.as_of` (computed) | the `_observed_at` suffix is consistent and good; `as_of` is used for three different things | now: `clans_roster.lifetime.as_of` → add `profile_observed_at` beside it; docs: "as_of is when the sums were done; *_observed_at is when the recorder saw it" (already in clocks.md, restate on responses.md) |
| `season` | `season_id` (war number), `season_month` (API name), `season` argument (either, on 4 tools + rankings), `applied.window.season {month, war}`, `seasons` (a count, `war_history`), `progress[].season_month`, `pol` season (unserved), the Pass season (not modelled) | `game_clock` note and `clocks.md` "Seasons" say the three namespaces | none beyond serving `season` on every windowed tool (2.3) |
| `deck_hash` / `deck` / `cards` / `decks_used` / `deck_selection` | identity; the played cards object; the identity's cards; war decks (a count of battles' worth); the API's draft flag (unserved) | yes | none |
| `level` | in-game 1-16 everywhere recorded; rarity-relative on `live_fetch`; `king_tower_level`; `pol_league` vs `league_number` (the same PoL league under two names: `players_timeline.pol_league`, `battles_query.league_number`) | the 1-16 rule yes; the league pair no | glossary: "league_number and pol_league are the Path of Legends league (1 = unranked)"; major: pick one |
| `arena` | name on the battle row; id on the snapshot and `progress[]`; `{id, name}` on `trophy_floor` and `modal_arena`; `arena_id` argument on `battles_levels` filters by looking the name up | no | `battles_query` rows: `arena_id` beside `arena` now; `{id, name}` object at the major |
| `kind` | snapshot kind (daily/pre_reset/season_roll); timeline item kind; period kind (war/training); badge kind (one_off/tiered); entry kind (player_activity/clan_activity); `crosses[].kind` | each locally | none; note the five in the glossary |
| `source` | a point's `source` (api/elixir-bot); `applied.window.source`; `trophy_floor.source`; `players_search` match `source`; `war_rivals.applied.source` | each locally | none; glossary |
| `partial` / `complete` | `battles_performance` weekly `partial: true` + `covers`; `clans_participation.weeks[].complete`; nothing on `battles_trends` | 3.13.0 for the first | one spelling (2.4) |
| `limit` | rows (most tools); members (`clans_members_timeline`); snapshots (`rankings_timeline`); release entries (`elixir_changelog`) | yes in each description | none |
| `clan_tag` on a player | on a member point: "the clan the day's last roster placed them in"; on a battle opponent: the clan at battle time; on `players_summary.clan`: last known | the first yes (note) | say the second and third once on `battles.md` |

### 2.3 Grain and window

| Family | Grain | Window arguments | `applied.window` | Season boundary |
|---|---|---|---|---|
| series (`players_timeline`, `clans_timeline`, `clans_members_timeline`) | game day (10:00Z) | `from`/`to` **YYYY-MM-DD only** (an instant is refused, `bad_request`, live `e4df1a57`); `days`/`weeks` = N game days today included | `{from: date, to: date|null, source: argument|unbounded, timezone, season, crosses, season_age_days}` | said (`seasonFieldsForDays`, the roll note; live `34d6747c`) |
| battle tools (`battles_query`, `_performance`, `_decks`, `_cards`, `_opponents`, `_compare`) | instant | `from`/`to` instants or dates in zone; `days`/`weeks` = now minus N | `{from, to, source: argument|default|unbounded, timezone}` | **not said**: a `days: 60` `battles_decks` window spanning the 09-07 roll carries no `season`/`crosses` (live `1cfc9f68`), while the same span on `battles_trends` does |
| meta (`battles_meta_decks`, `_cards`, `cards_synergy`) and `battles_trends` | instant; season default | + `season` | + `season`, `crosses`, `season_age_days` | said |
| pilot (`battles_levels`, `clans_pilot_scores`) | instant | `days` only (7-365) | `{from, to, source: default|argument, days}`; no season fields | not said; a 90-day curve crosses a roll by default |
| `clans_standings` | instant | `from`/`to`, `days` (1-90) | `{from, to, source, timezone}` + `days` beside | not said |
| `clans_participation` | ISO week (Mon 00:00Z) for battles/donations; war week (Mon 10:00Z grid) for decks/points | `weeks` (1-8) only | `{from, to: null, source: argument}` (always "argument", even for the default 5) | two grids, both listed; the join is the consumer's (`clan.poapkings.com` `awards.mjs:83-89`) |
| `war_history` | war season/week | `seasons` (count), or `season_id` + `section_index` | `applied.seasons` / `season_id, section_index` (no instants) | n/a |
| `rankings_timeline` | snapshot instant | `from`/`to`, `days`/`weeks`; default "the current season so far" | `{from, to, source}` (source `argument` even when defaulted? live `f41e4ebb` with `days: 14` → argument, correct) | not said |
| `game_events` | UTC day | `from`/`to`; default season so far | `{from, to, source: default|argument}` | n/a |
| `elixir_timeline` | instant; 30-day and 200-item caps | `from`/`to`, `days`/`weeks` | `{from, to, source}` | n/a |
| `players_summary` | fixed 30 days | none | `{from, to, source: fixed, days: 30}` | n/a |

Three inconsistencies matter to an agent: the same two argument names take
two grammars (a series tool refuses the instant every other windowed tool
accepts); the season echo exists on eight tools and is absent on the seven
battle tools whose windows cross rolls just as often; and `clans_participation`
echoes `source: argument` for its default. Everything else is declared where
the agent meets it.

### 2.4 Point shape

Eight series shapes on the wire today (a ninth, `clans_participation`, is
positional arrays aligned to `weeks[]`, by decision for the cap):

| Tool | Key | Stamps | Kind / source | Clipping | Count behind an aggregate |
|---|---|---|---|---|---|
| `players_timeline.series[]` | `date` (+ `iso_week` weekly) | `observed_at`, `profile_observed_at`, `roster_observed_at` | `kind`, `source` | n/a | n/a |
| `clans_timeline.series[]` | `day` (+ `iso_week`) | `observed_at` | `kind`, `source` | n/a | `members_seen` (roster rows), no count of profile rows behind the profile aggregates |
| `clans_members_timeline.members[].series[]` | `day` (+ `iso_week`) | all three | `kind`, `source`, `clan_tag` | n/a | n/a |
| `players_timeline.progress[]` | `day` | `observed_at` | `key`, `mode`, `season_month` | n/a | n/a |
| `rankings_timeline.points[]` | `observed_at` + `unchanged_until` | (the key is the stamp) | — | n/a | `rated_players` |
| `battles_trends.weeks[]` | `week_of` + `iso_week` | — | `season_month` | **none** (W38 is 5 of 7 days; live `1d0c9fdb`) | `battles`, `players`, `trophy_battles` |
| `battles_performance.weekly[]` | `week_of` + `iso_week` | — | — | `partial: true` + `covers {from, to}` (3.13.0) | `battles`, `trophy_battles` |
| `battles_levels.monthly_trend[]` | `month` (YYYY-MM) | — | population fields (3.13.0) | none (the first and last months are clipped by `days`) | `n` |
| `elixir_timeline.timeline[]` | `at` | — | `kind`, `section` | `timeline_more` | `facts` |

Which differences are the entity's: the key (a day, a week, a month, an
instant) and the stamps (two writers on a member row, one on a clan row, a
snapshot's confirmation span on a board). Which are accidents: `date` vs
`day` for the same game day (decision 3 of Phase 4 kept `date` for
compatibility; the output schema already allows both); `partial`/`covers` on
one weekly series and not the other two; `source` on the series points and
nowhere on the weekly buckets (whose rows can be bot-imported rollup keys,
NOTES 2026-09-18 Phase 3: 300 keys); `players` as the count on trends and
`members_seen` on the clan series.

**The one point vocabulary (additive path).** Every point carries exactly one
key of `day` (game day), `week_of` (ISO Monday, with `iso_week`), `month`, or
`at` (instant); `observed_at` when the point is an observation, plus the
writer stamps where two writers share the row; `kind` where the row has one;
`source` where an import can have written it; `partial: true` with `covers
{from, to}` whenever the window or the record clips the bucket; `season_month`
on any bucket that is not a game day; and the count behind any rate
(`battles`, `n`, `members_seen`, `rated_players`) on the point itself.
Additively: `players_timeline` adds `day` beside `date` now and retires
`date` at the major; `battles_trends` gains `partial`/`covers` via
`markPartialWeeks` (already in `controls.mjs`); `clans_timeline` gains
`members_with_profile` beside `members_seen`; `rankings_timeline` gains `day`
(the game day the snapshot fell in) beside `observed_at`; `battles_levels`
monthly points gain `partial` for the two edge months; `battles_trends` and
`battles_performance` weekly gain `source: api|elixir-bot` when any rollup
key in the week is imported.

### 2.5 Nullability

Every `null` observed live, with whether the meaning is stated where the
agent meets it.

| Field | Meaning of `null` | Stated? |
|---|---|---|
| `battles_query.me.trophy_change` | not a trophy mode, or a loss ON the floor | yes (3.13.0 note + battles.md) |
| `war_current.standings[].rank`, `trophy_change`, `finish_time` (live `967e09d6`) | the week is in progress; `finish_time` null = boat not finished | **no** (battles.md covers only `period_points: null` on restored rows) |
| `war_current.next_war_day_opens_at`, `period.next_war_day_opens_at` | on a war day: defect 2 | wrong |
| `war_history.weeks[].our_rank/our_fame` | capture gap on older weeks; `in_progress` on the latest | yes |
| `war_history.member_weeks[].war_days_battled` | attendance unknown (not zero) | yes |
| `clans_participation` `donations`, `war_decks`, `war_decks_by_day` | no snapshot / not polled | yes ("Null is unknown, never zero, throughout") |
| `clans_participation.members[].battles` = `0` | **0 for a member whose log is not recorded** (activity-scope clans: every member) | **no**; the "never zero" rule is broken for the one column it matters most on |
| `clans_standings.trophy_net` = `0` | no ladder battles OR a net of zero (`standings-sql.mjs:74` `coalesce(…, 0)`; 17 of 42 ranked members read `0` live `2fdac89d`) | **no** |
| `clans_standings.win_rate`, `current_streak` | no decided battle | yes |
| `clans_standings.years_played`, `clans_roster.years_played`, `account_age_days`, `players_profile.attributes.years_played` | YearsPlayed badge absent (usually under a year) | glossary only; not on the tools |
| `clans_roster.members[].lifetime` | profile not recorded | yes |
| `players_timeline` lifetime metrics on a roster-only day | no profile poll that day | yes (note) |
| `players_timeline.collection_level` = `0` | defect 10 | wrong |
| `players_timeline.season_trophies` | no seasonal-road bucket on that day's payload | **no** |
| `players_timeline.pol_rank` = `null` with `pol_league: 1, pol_trophies: 0` | not in Path of Legends this season | **no** |
| `players_profile.league_statistics` | the API sent no `leagueStatistics` | no (3.11.1 says every key nullable) |
| `clans_timeline` profile aggregates | no member with a recorded profile that day | yes |
| `rankings_timeline.best_rank`, `best_player_tag` | no rated players (24 identical zero points live `f41e4ebb`) | no note; the response should say the clan had no rated player in the window rather than 24 rows of zeros |
| `elixir_timeline.read_to` | no pointer on the account yet | **no** (timeline.md says "your pointer after this call") |
| `battles_levels.player` absent, `insufficient_sample: true` | below the floor | yes |
| `elixir_coverage.is_complete`, `ratio` | counters not comparable | yes (interval `note`) |
| `elixir_coverage.incomplete_days` | always null | yes ("deprecated") |
| `game_events.description` | the API sent none | fine |
| `players_search` result empty | honest empty | yes |

### 2.6 Denominators and units

The battles page names every rate's denominator and the 3.13.0 controls
made `n`, `decks_used` and `trophy_change` exact. Checked against the same
bar:

- `clans_timeline.avg_member_trophies`: the mean over that day's member rows
  with a trophies value; the note says what `members_seen` counts, not that it
  is the denominator. `donations_per_week` is the game's weekly clan counter
  (cards donated this week, resets Monday); the series tools say this for a
  member's `donations` and not for the clan's.
- `clans_timeline` profile aggregates: "members_seen against the count of
  non-null values says how many that is" (the note) but the count of non-null
  values is not served; a `members_with_profile` field is the missing
  denominator.
- `battles_trends.win_rate`: wins/(wins+losses) is not stated on the tool
  (the note is about composition); `net_trophies` over `trophy_battles` is a
  field pair, good.
- `clans_participation.war_points`: participants' `points` per war week; the
  unit (race points) and the identity with `war_current.participants[].points`
  are not said.
- `clans_standings.trophy_net`: ladder only, said; the count of ladder battles
  it sums over is not served (the `0` ambiguity above).
- `players_summary.top_deck.win_rate`, `last_30_days.win_rate`: pooled across
  modes with no `modes` split (Part 4).
- `war_rivals.mean_fame`: over finished races, said; the mix of Colosseum and
  regular weeks (scored differently in the game, `clocks.md`) is not said.
- `avg_member_wins`, `avg_member_collection_level`: lifetime counters
  averaged per day; "wins" reads as window wins. Say "lifetime" in the
  metric description.

---

## Part 3: agent usability

### 3.1 The eight journeys

Each was planned from `tools/list`, the `initialize` instructions and
`elixir_docs` only, then made read-only as King Thing (POAP KINGS). "One-shot"
is the calls a design that answered the question directly would need.
Latency is the 14-day audit (avg / p95, ms). Score is out of 5.

**J1. "How am I doing this season?"** Calls made: `game_clock` (season
bounds) → `players_summary` → `battles_performance({from: season start})`
→ `battles_decks({days: 30, min_battles: 2})`: 4; one-shot 2. Guesses: the
season is not a window on any player tool (`players_summary` is a fixed 30
days, `source: fixed`; `season` exists on four tools), so the agent reads
`season_started_at` from `game_clock` and types it as `from`. Notes present
and needed: `trophy_floor` (King Thing is floored at 12,500: 3 on-floor and 4
landing losses, `d1cd73e7`), the partial-week note, `comparable: false`
naming the war Mortar deck against the ladder Hogs deck (`5120a30a`). Numbers
without a control: `players_summary.last_30_days.win_rate` and
`top_deck.win_rate` (45 ladder battles at 0.422) pool modes and carry no
floor. Sizes: 2-4 KB each. Latency: summary 82 / 245; performance 597 / 1,540;
decks 413 / 569. **Score 3.5**: right answers, one call too many, one number
that the principle has not reached.

**J2. "Which deck should I play on ladder?"** `battles_decks({mode: ladder,
days: 60, min_battles: 3})` → `battles_meta_decks({segment: {clan_tag},
mode: ladder})` → `battles_levels({mode: ladder})`: 3; one-shot 2. Guesses:
whether "the meta" means the clan or the corpus (the description says the
corpus by default; an agent acting for a clan has to remember the segment,
which is the discord memory template `agent/memory.md:7`). Controls present:
`comparable: true` within one mode (`1cfc9f68`); on the clan meta every deck
carries `players: 1` (`74fb091c`), which is the control and the finding: a
clan meta of 46 players is one player per deck. Missing: the meta rows carry
no `mean_level_gap` and no mode split when `mode` is omitted (Part 4).
Sizes 4-28 KB. Latency: meta decks 7,536 / 18,772 with 6 `query_timeout` in
68 calls (14 d). **Score 3**.

**J3. "Who in the clan is slipping?"** `clans_standings({days: 7,
min_battles: 3})` → `clans_participation({weeks: 2, verbosity: compact})` →
`clans_members_timeline({days: 5, verbosity: compact})` (+ `clans_roster` for
`last_seen_in_game`): 3-4; one-shot 1-2. Guesses: what "slipping" is (win
rate, trophies, activity, presence) and which of four tools carries each;
the four are joined by tag client-side. `clans_members_timeline` returns
"the first N by tag" (a note says so, `cddceda9`), so a 46-member clan with
`limit: 50` fits and a 50-member clan does not, with no way to ask for the
movers. Numbers without a control: `trophy_net: 0` (no ladder battles vs
net zero); `clans_participation.battles` (recorded only; every member of an
activity-scope clan reads 0); per-member `win_rate` pooled across modes.
Sizes: participation `weeks: 8` full 39.9 KB for 46 members (`deda3eec`);
the 14-day census shows 4 of 59 calls truncated, max 158,661 bytes (a
50-member clan at eight weeks); a compact `clans_members_timeline` for 46
members is ~45 KB. Latency: participation 7,533 / 18,534; standings 2,474 /
6,432. **Score 2.5**: the facts exist, the join and the judgment are the
agent's, and two of the four responses sit at the cap.

**J4. "Did we win the war, and who carried?"** `war_history({seasons: 1})` →
`war_history({season_id: 136, section_index: 0})`: the second call is defect
1 (HTTP 500, 25 s). Fallback the agent finds: `clans_participation` and its
positional `war_points` column for war week index 8, or `war_history` per
member (46 calls). One-shot 1. Guesses: "carried" = `points` not `fame`
(the note says so); `history_starts_at` misleads (defect 3). Missing: the
day-by-day (`war_period_log`, unserved). Latency: war_history 281 / 572 for
the paths that answer. **Score 2**: the natural path fails.

**J5. "What changed for me since last month?"** `battles_performance({from:
2026-08-07, before_after: 2026-09-07})` → `players_timeline({weeks: 6,
granularity: week, metrics: […]})`: 2; one-shot 2. Guesses: `before_after`
takes a date, not `season: previous`; the weekly series shows
`collection_level 0 → 1754` (defect 10) and `season_trophies: null` with no
meaning stated. Present and needed: the crossing note ("Window spans S135 and
S136"), `trophy_floor`. Sizes 3-4 KB; latency 124-597 avg. **Score 3.5**.

**J6. "Is this clan worth joining?"** (a recorded clan) `clans_roster({clan_tag})`
→ `clans_timeline({clan_tag})` → `war_history({clan_tag})` → (`war_rivals`):
3-4; one-shot 2. Guesses: type/location/description are not on any tool (the
first thing a joiner asks; collected since 0127); an activity-scope clan's
`clans_timeline` profile aggregates are null and `clans_participation.battles`
read 0 with nothing saying the scope is why (`elixir_data_insights` lists the
scope, three calls away). For an unrecorded clan: `clans_roster({clan_tag,
live: true})` → `live_pending` → retry (the 14-day log shows 9 `not_recorded`
+ 6 `not_entitled` on `clans_roster`). Sizes: roster 11 KB avg, 29 KB max.
**Score 3**.

**J7. "What is the meta right now at my level?"** `battles_meta_decks({mode:
ladder})`: 1 call, wrong population. The corpus meta pools every trophy
band; `battles_levels` takes `trophy_band` and `arena_id` but scores levels,
not decks; no meta tool takes a band. `battles_meta_cards` for the corpus:
5,912 decided, `Arrows` 0.512 (`227dcdec`) — the number is right for a
population the asker is not in. **Score 2**: the question has no honest
answer today (product call 1).

**J8. "What happened today?"** `game_clock` → `elixir_timeline({days: 1,
mark_read: false, verbosity: compact})`: 2; one-shot 1. Present: 47 items,
9 entries, 3 quiet, oldest first, sentences a person can read (`644a1bdf`).
Guesses: `sections`/`kinds` to keep it under the cap (a 7-day compact read
was 69,940 bytes and overflowed, capture `aafa7786`). Latency 290 / 912.
**Score 4.5**.

| Journey | Calls / one-shot | Guesses | Missing control or field | Score |
|---|---|---|---|---|
| J1 season | 4 / 2 | season as a player-tool window | `players_summary` mode split, floor | 3.5 |
| J2 ladder deck | 3 / 2 | corpus vs clan segment | meta rows: level gap, mode split | 3 |
| J3 slipping | 3-4 / 1-2 | which tool means what; join by tag | `trophy_net` 0, `battles` 0, member ordering; two responses at the cap | 2.5 |
| J4 war | 2 / 1 | — | **defect 1**; `war_period_log`; `history_starts_at` | 2 |
| J5 since last month | 2 / 2 | `before_after` date | `collection_level` 0; `season_trophies` null | 3.5 |
| J6 join | 3-4 / 2 | scope explains the nulls | clan type/location/description | 3 |
| J7 meta at my level | 1 / 1 | — | no trophy band on the meta tools | 2 |
| J8 today | 2 / 1 | sections to fit the cap | — | 4.5 |

### 3.2 The seam

**`initialize` instructions.** True after 3.12/3.13 except defect 5 and the
`completeness_note` promise (defect 13). Length: ~2,400 characters for an
agent (identity, conventions, start, feedback, disclaimer); every sentence
is load-bearing except the live-lane paragraph, which repeats the four tools'
own descriptions. The agent block's "poll the feed and `elixir_my_feedback`
only when [the hints] say there is something new, never on a timer" cannot be
followed by a consumer that keeps its own cursor: `meta.timeline_pending`
counts since the account's pointer (`agents.md`: "only meaningful if
something marks"), and the three Discord agents never mark (Part 6).

**Descriptions.** Mean 425 characters, 23,355 bytes of the 131,200-byte
`tools/list`; 54,446 bytes are schemas, of which 15,000 are the same
argument descriptions inlined 20 times (`timezone` ×20, `to` ×15, `from` ×15,
`on_behalf_of` ×12, `mode` ×11; the census script's "wasted" column). Six
exceed 600 (defect 12). Load-bearing: the first sentence's default phrase on
every subject tool, the "what compact drops" line, the `season` argument's
four spellings. Padding: `elixir_timeline`'s 939 characters restate
`timeline.md`; `clans_roster`'s 714 list every lifetime field.

**`choosing-a-tool`.** The question table names 24 of 55 tools. Absent:
`players_timeline` (the series entry point), `battles_levels`,
`battles_trends`, `battles_cards`, `battles_opponents`, `battles_compare`,
`war_history`, all five `rankings_*`, `game_events`, `elixir_coverage`,
`clans_pilot_scores`, `cards_synergy`, `players_profile`,
`players_collection`. The "Three sequences" predate the series (no "how have
I moved" sequence) and the 3.13.0 controls (no "read `comparable` before
ranking"). Its convention list says `source` has five values while the
instructions say three.

**`elixir_examples` and prompts.** Never called in 14 days by anyone but this
review (`never_called`). The eleven examples are also the eleven prompts;
`prompts/get` and `resources/read` are not audited (handler.mjs audits
`tools/call` and refusals only), so whether any client surfaces them is
unmeasurable (Part 7).

**Error hints.** Every code names one executable next step; `internal` and
the `result_too_large` sizing hint are doing their job (0 `internal` on the
3.13.0 side of the window besides the three `battles_opponents` it fixed).
Two gaps: the transport-level timeout (defect 1) bypasses the closed set
entirely, and `live_pending` carries its one number in prose (defect 8).
Consumers pin the error set in comments (`elixir-mcp-discord/src/feedback.js:171-185`
lists the 1.0.0 codes; `live_pending`, `query_timeout`, `internal` are
"unexpected" there, so a pending live read prints "⚠️ 1 of N tool calls
failed" under a post and fires a reflection sweep). The contract has no
machine-readable class for "not a failure, call again" vs "your call is
wrong" vs "the server failed"; every consumer derives one.

**`outputSchema`.** 13 tools declare one (`players_profile`, `players_summary`,
`players_timeline`, `elixir_coverage`, `battles_decks`, `battles_performance`,
`battles_query`, `clans_members_timeline`, `clans_roster`, `clans_standings`,
`clans_timeline`, `war_current`, `elixir_timeline`). Called enough in 14 days
to deserve one: `elixir_my_feedback` (1,186 calls; the discord consumer
hedges four field names, `feedback.js:374,401-408`), `rankings_players` (404),
`war_history` (205; elixir-bot hedges `points|series` on the other player
tool and assumes "newest-first" here), `battles_meta_cards` (102),
`battles_levels` (69), `battles_meta_decks` (68), `clans_participation` (59;
the one consumer that reads every field).

**Resources and prompts.** Declared and served (`resources.mjs`); the corpus
is the same one `elixir_docs` reads. Unaudited, so "nobody calls" is a guess
with no number behind it.

**Naming at the connector.** The Claude connector mangles `elixir_feedback`
to `elixir-mcp_feedback`; the discord runner tail-matches and prefers the
shortest so it beats `elixir_my_feedback` (`src/mcp.js:115-162`). The
`elixir_` prefix collides with `<server>_` mangling by construction; the pair
`elixir_feedback` / `elixir_my_feedback` differs by an infix. Not a defect
today; a hazard for the major.

---

## Part 4: the 3.13.0 principle, applied everywhere it has not been

The principle: every aggregate ships the control next to the number; the
note fires on a detected confound, never as boilerplate. Applied to
`battles_decks`, `battles_cards`, `battles_levels`, `battles_performance`,
`battles_query`. The matrix for everything else that serves a rate, trend,
rank or sum. "Carrier" is the cheapest place; "helper" names what
`controls.mjs` already has or should gain.

| Tool · number | Confound | Control present? | Cheapest carrier | Helper |
|---|---|---|---|---|
| `players_summary` · `last_30_days.win_rate`, `top_deck.win_rate`, `net_trophies` | mode mix (war vs ladder); the floor | none | `last_30_days.modes` (the split), `top_deck.modes` + `dominant_mode`, `trophy_floor` (already computed for the same window by `battles_performance`) | `modeSplit`, `dominantMode`, `trophyFloor` (exist) |
| `clans_standings` · per-member `win_rate`, `trophy_net`, `rank` | mode mix per member; `trophy_net` 0 vs none; level gap | median ✓, `below_floor` ✓ | per member `modes` (from the daily rollup's `mode_group`, one extra group-by), `ladder_battles`, `mean_level_gap`; response `comparable` and one note naming the members whose dominant modes differ | `modeSplit`, `comparabilityNote` (exist; `label` = name) |
| `battles_trends` · weekly `win_rate`, `net_trophies` | composition (`players` ✓); clipped weeks; mode pooled; imported keys | `players` ✓, `season_month` ✓, `crosses` ✓ | `partial`/`covers` on clipped rows; `modes` per week; `source` when a week holds imported rollup keys | `markPartialWeeks`, `modeSplit` (exist) |
| `battles_meta_decks` / `_cards` · `win_rate`, `shrunk_win_rate`, `usage_share` | mode pooled by default (`mode` omitted = every mode: the #54 confound at corpus scale); level gap per row; `players: 1` rows on a clan segment | `players` ✓, `excluded` ✓, `prior` ✓, `insufficient_sample` ✓ | per row `modes` (the rollup is keyed by mode group and carries an `all` row, so the split is one query on the rollup path) and `mean_level_gap` (raw path: a lateral avg as `battles_decks` does; rollup: a new column, nightly); response `comparable` and the pooled note when the groups' gaps differ ≥ 0.5 | `pooledModesNote`, `modeGaps` (exist); a `players_min` guard: when the top rows are single-player, a note saying the segment meta is a few players' decks |
| `cards_synergy` · `co_occurrence_rate`, `lift` | mode pooled; `players` per pair ✓ | `players` ✓ | `modes` on the anchor's decks; nothing else: co-occurrence is not a success rate | `countByMode` |
| `clans_pilot_scores` · `pilot_score` per member | population change inside the window per member (the #55 confound) | `n`, `mean_gap`, `standard_error` ✓ | per member `mean_starting_trophies`, `modal_arena`, `expected_from_levels` ✓ (the `lv_pairs` CTE carries `starting_trophies` and `arena` since 3.13.0); a note when a member's modal arena inside the window differs from their current arena | the `battles_levels` trend guard, lifted to a member row |
| `clans_participation` · `battles`, `ranked_battles`, `war_decks`, `war_points` | recorded-only counts: 0 means "not recorded" for every member of an activity-scope clan; imported history before the join | the note "Counts cover RECORDED battles only" ✓ (boilerplate) | per member `log_recorded: true|false` (comprehensive members and directly recorded players) and clan-level `basis: recorded | roster_and_war_only` as `elixir_timeline`'s clan entry already carries; `last_battle_time` clipped to `joined_observed_at` or a second field `last_battle_time_in_clan`; per war week `war_days_battled` (the count `war_history` already computes) so a consumer never spreads a weekly total over days (`clan.poapkings.com` `facts.mjs:45-74`) | new: `coverageBasis(clan)` |
| `clans_timeline` · `avg_member_trophies`, profile aggregates | denominators; members who left that day | `members_seen` ✓ (wrong note, defect 9) | `members_with_profile`; `members_seen` note corrected ("rows the roster wrote, including members who left that day") | — |
| `clans_members_timeline` compact · `delta` | first/last are roster days with `profile_observed_at` null on one end (the delta of a lifetime metric across a roster-only endpoint is null already) | roster-only note ✓ | nothing more | — |
| `war_rivals` · `mean_fame`, `median_fame` | Colosseum weeks scored differently; `races_observed` small | `races_observed` ✓, `zero_fame_races` ✓ | `colosseum_races` count; `clan_score` (unserved) as the strength control beside fame | — |
| `war_current` · `standings[].fame`, `period_points`; `decks_today` | `race_finished_at` ✓; over_cap ✓ | ✓ | `clan_score` per standing row | — |
| `war_history` · `our_rank`, `our_fame` | capture gap null ✓; `finished_early` ✓ | ✓ | `days[]` from `war_period_log` when the week is exact | — |
| `rankings_players` / `rankings_clans` / `rankings_clan_ladder` · `rank` | season fill ("a board is small in a season's first days") | note ✓, `unchanged_until` ✓ | `snapshot.entries` beside the page (`rankings_players` has it; `rankings_clans` should say the field size it counted over) | — |
| `rankings_timeline` · `rated_players` | none rated | — | one note when every point is zero: "no rated player in the window" | — |
| `badges_rarity` · `holder_share` | staleness of badge state per player | `players_considered`, `observations` ✓ | nothing more | — |
| `elixir_timeline` clan entry · `activity` | scope | `basis` ✓ | nothing more | — |
| `players_timeline` · any metric | roster-only days; imported days | notes ✓ | `partial`? n/a | — |

**Coverage as a control.** `elixir_coverage` measures a player's capture;
nothing puts that measure on the number. `meta.completeness_note` is the
designed carrier and is never set (defect 13). The cheapest honest carrier is
not per-call coverage math (it is 10 queries, 177 ms avg on `elixir_coverage`)
but the two facts every clan tool already knows for free: whether each
member's log is recorded (`recording`/`clan` scope, one query per call) and
`recorded_since` per member. Recommend: (a) the invoker sets
`meta.completeness_note` from `coverage.mjs`'s cached last-7-day ratio when a
subject tool's window ends in the last seven days and the ratio is below
0.9, one indexed read, so the promised control fires; (b) clan tools carry
`basis` and `log_recorded` as above; (c) `recorded_since` per member on
`clans_standings` and `clans_participation`, the same field `meta` carries
for a single subject.

**Additions to `controls.mjs`** (no per-tool copies): `coverageBasis(db,
clanTag)` → `{basis, members: Map(tag → {log_recorded, recorded_since})}`;
`singlePlayerNote(rows)` for meta segments where the returned rows' `players`
are all 1; `colosseumMix(weeks)` for `war_rivals`; `zeroSeriesNote(points,
field)` for `rankings_timeline`; and `modeSplit` lifted to take the rollup's
per-group rows so `clans_standings` and the meta path share it.

---

## Part 5: cohesion, one product or annexes

### 5.1 The map an agent meets today

Twelve groups, fifty-five tools, one identity paragraph. The entry points
the instructions name: `players_summary` (person), `clans_roster` +
`war_current` + `elixir_timeline` (agent). From "who am I" the paths are:

- **Me, now:** `players_summary` → `battles_performance` → `battles_decks` →
  `battles_query`. One grammar (instants), one echo, controls since 3.13.0.
- **Me, over time:** `players_timeline` (game days, date-only, stamps) and
  `battles_performance group_by: week` / `battles_trends` (ISO weeks) and
  `battles_levels.monthly_trend` (months). Three grains, three point shapes,
  one of them (`battles_trends`) with no clipping flag.
- **My clan, now:** `clans_roster` → `war_current` → `clans_standings` /
  `clans_participation` (two grids). Facts, no controls.
- **My clan, over time:** `clans_timeline`, `clans_members_timeline` (game
  days) and `war_history` (seasons). The series are cohesive with
  `players_timeline`; `war_history` is 1.0.0 with a horizon bug and a
  timeout.
- **The corpus:** the meta tools (season default, no band), `cards_synergy`,
  `badges_*`, the boards (snapshot instants), `game_events` (UTC days).
- **The seam:** `elixir_docs`/`examples`/`changelog`/`updates`, `elixir_coverage`
  (unconnected to any number), `elixir_feedback`/`my_feedback`.

Where the seams show: two window grammars under one pair of argument names;
the season echo on eight tools of fifteen windowed; `arena` as name and id;
the lifetime block in two casings; `next_war_day_opens_at` with two meanings;
`date` vs `day`; `partial` vs `complete`; `trophy_net` vs `net_trophies`;
`pol_league` vs `league_number`; the 0131 facts, the war day log, the PoL
finals, the clan's type and the rivals' scores collected and unreachable;
the docs corpus with `battles.md`, `methodology.md`, `responses.md` and
`clocks.md` refreshed this week and `quickstart.md`, `about.md`,
`agents.md`, `glossary.md`, `verify.md`, `connections.md`, `limits.md`,
`activity.md`, `architecture.md` last touched 09-10 to 09-15, before the
game day, the series, the manifest and the controls existed (the glossary
has no entry for game day, series, stamp, source, kind, progress bucket,
manifest, control, comparable, floor).

### 5.2 The interface it should be

One record, read through one grammar. Every windowed tool takes `from`/`to`
as an instant or a date and echoes `applied.window` with the season it
starts in and every roll it crosses; a series tool floors an instant to its
game day and says so rather than refusing. Every point on the wire carries
one key (`day`, `week_of`, `month`, `at`), its stamps, its `kind` and
`source` where the row has them, `partial`/`covers` when clipped, and the
count behind its rate. Every aggregate carries its controls from one module,
and the note fires only when a confound is detected. `arena` is `{id, name}`
everywhere; the lifetime block is one shape; a battle row carries the facts
the log carries, so `battles_query` is the whole battle and `game_events`,
`battles_decks` and the war tools can be joined to it by id. `war_history`
answers a closed week's roster and day-by-day in one call under a query
budget. `elixir_coverage`'s measure reaches the envelope of every subject
tool as `completeness_note`, and the clan tools say whose log is recorded.
`choosing-a-tool` is the full map; the glossary has the redesign's words;
the instructions are true. The consumers' workarounds retire: the pending
retry is a field, the error codes carry a class, the timeline has a named
reader pointer, `percentile` is served, the clan default is the primary's
clan.

### 5.3 The additive path, and what is batched for the major

Everything in Parts 1-4 is a field beside an old one, a note, a docs page or
a test, except these, which change a meaning or a name and are batched for
**4.0.0 with a 30-day deprecation window** (elixir-bot pins the major and
logs once; discord DMs on every version; Clan and Drop read none):

| Rename / removal | Now (additive) | At 4.0.0 |
|---|---|---|
| `players_timeline.series[].date` | add `day` | remove `date` |
| `battles_query.arena` (string) | add `arena_id` | `arena: {id, name}` |
| `players_profile.snapshot.lifetime` camelCase | add the snake_case block as `lifetime_block`? no: keep and document | one shape (snake_case, the series' names) |
| `battles_performance({group_by: "mode"})` | add `group_by: "game_mode"` as a synonym | remove `"mode"` |
| `clans_standings.trophy_net` | add `net_trophies` beside | remove `trophy_net` |
| `players_timeline.pol_league` / `battles_query.league_number` | glossary | one name |
| `clans_participation.weeks[].complete` | add `partial` | remove `complete` |
| `elixir_coverage.average_ratio` (string), `incomplete_days` | document | number; remove |
| `war_current.nominal_period_elapsed` | — | remove |
| `war_current.next_war_day_opens_at` | fill on war days (defect 2: a null becoming a value is additive) | — |
| `elixir_feedback` / `elixir_my_feedback` | — | consider `feedback_send` / `feedback_mine` (the `<domain>_<verb>_<noun>` rule for writes already says `elixir_send_feedback`) |
| `segment` omitted on the six segment tools (= the corpus) | add `"mine"` and `"corpus"`; a note when omitted; `population` on a corpus read (Jamie, 2026-09-18: the corpus is an explicit choice, never a default) | `segment` required; a call without it refuses |

---

## Part 6: what the call log says

**Sample.** `{audit_census: {days: 14}}` at 2026-09-18 14:23Z: 9,953 calls
across three principal kinds (agent 5,842 / 5 accounts; person 1,271 / 2;
unknown 2,840 / 4, the pre-0063 rows and REST/web surfaces), ten surfaces,
seventeen client strings. The redesign's tools shipped 2026-09-18 02:34Z
(3.12.0) and 13:4xZ (3.13.0); the captured calls of 09-17 and 09-18 (1,712)
are the post-redesign side and the only per-client, per-argument view.

| Surface | Calls | Errors | Share |
|---|---|---|---|
| svc:elixir-mcp-discord (the 09-09 preview, last call 09-14) | 3,184 | 30 | 32% |
| svc:poap-kings-discord | 1,592 | 45 | 16% |
| svc:ship-it-discord | 1,396 | 9 | 14% |
| svc:elixir-kings-discord | 1,383 | 8 | 14% |
| mcp (Claude, Claude Code, Elixir Clan, OpenClaw, unnamed) | 1,313 | 51 | 13% |
| svc:collection-updater | 481 | 1 | 5% |
| svc:elixir-bot | 216 | 62 | 2% |
| rest / web / svc:elixir-drop | 388 | 1 | 4% |

### 6.1 Traffic shape

`elixir_timeline` is 4,045 of 9,953 calls (41%); 1,412 of the 1,712 captured
calls (82%). The three Discord agents each read it ~469 times in the two
captured days, one call every six minutes, always `mark_read: false`, 425 of
469 with `kinds`, 464 of 469 at full verbosity; **95-99% of those reads
return an empty timeline** (poap-kings 0.95, ship-it 0.99, elixir-kings
0.99; avg 2.6-3.0 KB each). The hint that should stop this
(`meta.timeline_pending`) counts since the account's pointer, which these
consumers never move. The empty read is cheap on two accounts (72 ms db)
and not on POAP KINGS: avg 801 ms, and two reads at full verbosity with 17
kinds took 13.5 s and 18.1 s of database time to return zero items
(`e3ab3573`, `b525e999`, 2026-09-17 13:45Z and 13:55Z). The 14-day max for
the tool is 18,287 ms.

Identity lookups still happen: 38 on Elixir Clan (`elixir_my_players` on
every evaluation, by design: the gate), 19 on an unnamed mcp client, 7 on
the old discord preview; the named Discord agents make none.

### 6.2 Latency

| Tool | Calls | avg ms | p95 ms | max ms | avg db ms |
|---|---|---|---|---|---|
| clans_pilot_scores | 17 | 9,637 | 21,576 | 22,568 | 4,828 |
| cards_synergy | 14 | 9,195 | 14,028 | 18,134 | 9,084 |
| battles_meta_decks | 68 | 7,536 | 18,772 | 20,615 | 7,803 |
| clans_participation | 59 | 7,533 | 18,534 | 19,224 | 7,410 |
| battles_meta_cards | 102 | 6,069 | 18,209 | 19,790 | 9,346 |
| battles_levels | 69 | 5,773 | 9,352 | 22,202 | 5,025 |
| clans_standings | 58 | 2,474 | 6,432 | 11,038 | 1,492 |
| battles_trends | 9 | 2,294 | 8,889 | 10,342 | 2,452 |
| elixir_data_insights | 16 | 818 | 2,578 | 4,104 | 1,518 |
| clans_roster | 163 | 687 | 2,563 | 6,942 | 509 |
| battles_performance | 221 | 597 | 1,540 | 12,327 | 479 |
| elixir_timeline | 4,045 | 290 | 912 | 18,287 | 193 |

Against consumer timeouts (discord 20 s, Clan 20 s, elixir-bot 15 s, Drop
3 s on REST): `clans_pilot_scores`, `clans_participation` and the two meta
tools sit at or over the p95 of every consumer's timeout, and only the meta
tools and `clans_standings` are under the 18-second query budget;
`clans_participation` (the one call Clan makes per evaluation), `battles_levels`
and `cards_synergy` are not, so their overrun is a Lambda timeout like defect
1. Cold starts: 453 of 7,112 measured (6.4%), 1,168 ms cold vs 462 warm.
The 3.11.1 window-predicate change is visible on the after side:
`battles_performance` avg db 479 (baseline 612), `battles_query` 428 (695).

### 6.3 Sizes and truncation

Truncated in 14 days: `clans_participation` 4 (max 158,661 bytes),
`elixir_my_feedback` 3 (max 99,805, pre-3.8.0), `live_fetch` 4 (raw
profiles), `battles_query` 2 (max 54,428: a `deck_hash` sweep at full
verbosity, 25 rows), `elixir_changelog` 2 (max 50,209), `elixir_timeline` 1
(69,745), `rankings_players` 1. The `result_too_large` sizing hint (3.13.0)
now names the page that fits; `clans_participation` has no page.

### 6.4 Errors, traced

Top codes: `war_history invalid_tag` 58 (all `svc:elixir-bot`, 14 days; the
bot passes a `player_tag` the normalizer refuses, `mcp_stats.py:102`, and
logs argument keys only, so the value is unknown here: an args-value census
would say); `war_current not_recorded` 14 (the one-member clans, answered by
#53 on 09-18); `battles_cards bad_request` 10 (all `days` before 3.7.0, the
9-day side); `live_fetch live_unavailable` 9; `battles_meta_cards query_timeout`
9 + `battles_meta_decks` 6 (corpus reads with `limit`/`segment`, 14 days);
`clans_roster not_recorded` 9 + `not_entitled` 6; `battles_query bad_request`
8 (`limit`/`verbosity`/`cursor`); `rankings_players not_found` 7 (a `board`
+ `location` pair that does not exist); `war_history bad_request` 7 (`weeks`
and `seasons`: the sugar mismatch on the one tool that takes `seasons`);
`battles_opponents internal` 3 (fixed in 3.13.0). Since 3.13.0: 0 `internal`.
What the log cannot say: argument values (by design), and nothing at all
about defect 1 (a timed-out Lambda writes no audit row and no capture).

### 6.5 Never called, and adoption

Never in 14 days: `elixir_track_player`, `elixir_track_clan` (person-only;
the web console does this), `badges_rarity`, `badges_holders`,
`clans_timeline`, `clans_members_timeline` (shipped 09-18 02:34Z; this
review made the first door calls), `elixir_examples`. Adoption of the seven
3.13.0 items (#54-#60): `calls_since_ship` 0-2 at 14:23Z, ten hours after the
deploy; the requester's next session is the measure. Older items are well
adopted (#48 `elixir_timeline` 2,513 calls since 3.4.2; #10 coverage 1,458).

### 6.6 The catch-all: `live_fetch`

44 calls in 14 days (0.44% of calls), 2 accounts, last on 2026-09-16. Paths:
`/locations/{id}/pathoflegend/players` ×20 (global 11, three locations 9),
`/clans/{tag}` ×11 (3 errors), `/players/{tag}` ×7 (3 truncated: a raw
profile with badges and cards does not fit the cap), `/clans/{tag}/currentriverrace`
×3, `/players/{tag}/battlelog` ×2 (refused as designed),
`/locations/global/rankings/players` ×1. Every frequent path has a recorded
tool with `live: true` (`rankings_players`, `clans_roster`, `players_profile`,
`war_current`). The catch-all is not signalling a missing tool; it is
signalling that an agent reached for the raw path before the tool, which is
the descriptions' job to prevent. One number: the PoL board path was used 20
times by a client that could have read `rankings_players` (which records
what it reads, so the record gained nothing from the raw path).

---

## Part 7: observability to stage

1. **A Lambda timeout leaves no trace in the record.** Defect 1 has no audit
   row, no capture, no `request_id` for the client. Smallest change: the
   invoker races every tool against `context.getRemainingTimeInMillis() -
   1500` and, on the deadline, writes the audit row with `error_code:
   'timeout'` and returns `query_timeout` with the request id; the query
   budget (`invoker.mjs:350`) extends from three tools to every tool whose
   14-day p95 exceeds 5 s. Cost: none. Closes: 4.4 and the J4 failure.
2. **`audit_census` has no `from`/`to`.** Fourteen days spans the redesign
   and cannot be split; the before/after of every phase below is one number.
   Add `{audit_census: {from, to}}`. Cost: one op change.
3. **Resources and prompts reads are not audited**, so "nobody calls them" is
   unmeasurable. Add a `resource`/`prompt` surface row (name, uri) to
   `mcp_call_audit` from the handler. Cost: one insert; no PII.
4. **`args_census` holds keys, never values, by design**; the 58
   `war_history invalid_tag` refusals from elixir-bot cannot be diagnosed
   here. Add a bounded, redacted value census for the tag-shaped arguments on
   `invalid_tag` refusals only (the tag as given, already stored in the
   captured request since 0063): `{refusal_census: {code: 'invalid_tag'}}`
   reading the captures.
5. **Controls have no adoption metric.** Whether `comparable: false`,
   `trophy_floor.floored`, `partial` fire, and whether the next call passed
   `mode` after one did, is in the captures and not in any census. Add
   `{controls_census: {days}}` over the captures: per control, fired / total,
   and the follow-up call's arguments.
6. **`elixir_timeline` has no explain op.** The two 13-18 s empty reads on
   POAP KINGS have no plan behind them. Add `{explain_timeline: {account_id,
   from, kinds}}` as `explain_series`/`explain_standings` exist.

---

## What I would do, in order

**Now, no decision needed (defects 1-14).** In leverage order: the
`war_history` budget and roster path (1); `next_war_day_opens_at` on war
days (2); `history_starts_at` as the true horizon (3); `arena_id` on the
battle row and the `battles.md` sentence (4); the instructions' `source`
list (5); serve `percentile` (6); one lifetime shape, additively (7);
`retry_after_s` as a field on `live_pending` (8); the `members_seen` note
(9); the `collection_level` zero census and null-fix op (10);
`completeness_note` from coverage (13); the `rankings_timeline` count (14);
the description-length test at 600 (12); `average_ratio` documented now,
numeric at the major (11).

**Next, additive and agent-facing (needs a nod).** The record to the wire:
the 0131 facts, `war_period_log` days, `clan_score`/`repair_points`, the PoL
finals, the clan's type/location/description, the three 0127 player
counters, `closed_at`, `api_period_type` (Part 1.3). The controls matrix
(Part 4) through `controls.mjs`. The one point vocabulary and the season
echo on every windowed tool (Part 2). `choosing-a-tool` as the full map, the
glossary's redesign words, the nine docs pages refreshed. `outputSchema` on
the seven called tools that lack one. The consumers' workarounds retired in
the same pass (Part 3.2).

**At the next major (batch them).** The table in 5.3, with a 30-day window
and `elixir_changelog` `breaking` entries.

**Product calls for the owner** (each with its trade-off; repeated at the
top of the plan):

1. **A trophy band on the meta tools** (J7: "the meta at my level"). Add
   `trophy_band` as a rollup dimension on `deck_meta_season` and
   `card_meta_season` (five bands × mode groups: ~5× the rollup rows, ~150 MB
   → ~750 MB over a season, nightly rebuild ~2-3 minutes longer) and as an
   argument on the three meta tools. Alternative: raw-scan only with the
   band (today's corpus scan, 8-15 s, `query_timeout` at the season's end).
   Recommend the rollup dimension; the cost is disk, the benefit is the one
   question a player's agent asks that the record cannot answer today.
2. **Serve the collected record** (Part 1.3): the 0131 battle facts on
   `battles_query` rows (~80 bytes per row at full verbosity), the war day
   log on `war_history`, the rivals' `clan_score`/`repair_points`, the PoL
   finals on `players_profile`, the clan's type/location/description. Or
   name any of them "unserved by decision" and the manifest keeps the reason.
   Recommend all of it; nothing needs a migration.
3. **One window grammar.** Series tools accept an instant and floor it to
   the game day (echoed as the day, with a note), rather than refusing.
   Trade-off: a silent floor could surprise; the echo and note are the guard.
   Recommend accept.
4. **A named reader pointer on `elixir_timeline`** (`reader: "editor"`,
   per-account named cursors; `meta.timeline_pending` computed against the
   oldest named pointer). Trade-off: a small table and one more argument
   against three agents polling an empty feed 700 times a day. Recommend it,
   with the empty-path cost (Part 7.6) fixed first.
5. **The segment tools' population.** DECIDED by Jamie, 2026-09-18, after
   this review was written: the review over-read the universal-reads rule.
   That rule (0.19) is about access, any account can read anything the
   record holds; it was never a statement that the whole corpus is a
   population, and the corpus is far too big to be one (309,000 players
   observed, 268,000 battles: the neighbourhood of eighteen clans). The
   rule is now: any population can be read, every population is stated,
   none is forced. Phase 3 adds `segment: "mine"` and `segment: "corpus"`,
   an omitted-segment note and a `population` block on corpus reads, and
   rewrites the instructions and glossary; 4.0.0 makes `segment` required
   on the six segment tools (kept in the batch). The `players: 1` note
   stays as a separate control.
6. **`game_events` on the game day.** Move `days_seen` to game days (the two
   daily reads at 04:42Z and 21:42Z both fall in one game day) or keep UTC
   as the literal sighting. Recommend game day, with `game_days_seen` beside
   `days_seen` until the major.
7. **The 4.0.0 batch and its window.** Thirty days, elixir-bot's pin bumped
   in the same week, discord's DM is the announcement. Or defer the major
   until a second batch accumulates. Recommend the window at the end of
   Phase 5.

**Open questions** (could not be settled read-only):

- Are the `collection_level: 0` rows (defect 10) from the 0123 JSON fill or
  the elixir-bot replay? The census op in the plan answers it.
- Is `players_timeline.pol_trophies` the same quantity as `rankings_players.rating`
  (the profile's `currentPathOfLegendSeasonResult.trophies` vs the board's
  `eloRating`)? `cr-agent-api-docs` does not say; one `npm run cr` pair on a
  ranked player settles it and the glossary gets a line either way.
- Which `board`+`location` pairs produced the 7 `rankings_players not_found`
  refusals (a retired mode board, or a location code)?
- What tag does elixir-bot send on the 58 `war_history invalid_tag` calls?

**Observability items:** Part 7, six items.

---

*This material is unofficial and is not endorsed by Supercell. For more
information see Supercell's Fan Content Policy:
www.supercell.com/fan-content-policy.*
