# Schema review: the Elixir MCP PostgreSQL model

Written 2026-09-17 against the brief in `2026-09-16-SCHEMA-REVIEW-BRIEF.md`.
Assessment only; nothing here has been applied.

## How this was done

- **Schema:** the 103-migration ladder applied to a fresh scratch database
  (`createdb` + `migrate()`), then read from `information_schema`,
  `pg_constraint` and `pg_indexes`: 65 tables, 68 foreign keys, 133 indexes.
- **Rows:** a disposable RDS clone (`elixir-mcp-review`, restored from the
  2026-09-16 05:56Z automated snapshot, read as a `pg_read_all_data` role
  over IAM auth, deleted after this document was committed). Counts below
  marked *clone* are from it: 217,978 battles, 509,252 participants,
  4,613,108 played-card rows. Live is ~10% larger (239,500 battles at
  05:23Z on 09-17).
- **Live plans and sizes:** the migrate Lambda's `{tables}`, `{stats}`,
  `{explain_meta}`, `{deck_census}`, `{audit_census:{days:7}}`.
- **Readers and writers:** every SQL statement in `services/mcp/src/tools`,
  `services/ingest/src`, `services/jobs/src`, `services/scheduler/src` and
  `services/web-api/src` was censused; the game's calendar was taken from
  `../cr-agent-api-docs`.
- **Candidate DDL** was executed in the scratch database to prove it parses
  and applies; nothing was run against the clone or production.

One thing learned here held for any caller and went to
`cr-agent-api-docs` (commit 53b3d34, "Season namespaces"): the API's
season key is the month, and the clan-war integer is the seasons-list
position minus 8. Section 1.1 rests on it.

## The one-paragraph verdict

The canonical tables are sound: every denormalized copy on the participant
agrees with its source (0 drift rows across 509k), every card row resolves
to the catalog, and the pending closing foreign keys would validate today
with zero orphans. The model's real gap is **time**. The game runs on a
calendar (seasons, and the balance patches that ride them, war weeks) and
the schema holds none of
it as rows: the season is a constant in `war-clock.mjs` (and the API's own
season key, the month, appears nowhere in the schema), 95% of battles
carry no season, the 5% that do include 3,230 stamps that contradict their
own `battle_time`, and the meta tools default to a rolling 28 days that
today mixes two seasons 14/86 without saying so. Fixing that is Tier 1 and
is also what makes the Tier 2 rollups possible, because a rollup needs a
grain that the game itself resets.

---

## Tier 1: do next (correctness and domain fit)

### 1.1 The season becomes a row; balance changes are not modelled

**Finding.** No `season` table exists. `seasonFromDate()` counts months
from a hard-coded anchor (`SEASON_ANCHOR = {id: 135, startMs:
2026-08-03T10:00Z}`, `services/ingest/src/war-clock.mjs:75`); `gameClock()`
returns `season_started_at`/`season_ends_at` by arithmetic. Every season
fact in the database (`battle.season_id`, `war_week.season_id`,
`ranking_snapshot.season_id`, `ranking_presence.season_id`) is an integer
that only code can turn into a date range, and nothing can validate it.
There is no balance-change data in the API (`cr-agent-api-docs`: a
repo-wide search for balance/patch/version finds only the level-cap note),
and **Elixir MCP will not model balance changes** (Jamie, 2026-09-17):
nothing hand-fed or scraped enters the data layer. The season is the
grouping that honours them. Supercell ships balance changes on the season
roll, so a season-bounded window is a balance-bounded window, and a
mid-season hotfix is simply invisible to the record, as it is to the API.

**Which key is the season's.** Probed live 2026-09-17 (recorded in
`cr-agent-api-docs/locations.md`, "Season namespaces"). The API names a
season by the month it starts in, `YYYY-MM`, and every other number is a
derived label for that same monthly season: `/locations/global/seasons`
lists `{id: "2026-08"}` rows; `leagueStatistics` names previous and best
seasons by it; a player's `progress` keys and arena raw names embed it per
mode (`seasonal-trophy-road-202609`, `2v2League_202609`,
`SeasonalArenas_202609_Arena1`); badges carry it (`SeasonalBadge_202509`);
Path of Legends finals are addressed by it and the player's PoL result
objects carry no season id at all. The clan-war `seasonId` (136 now)
appears only in `riverracelog`, never in the live race, and equals the
seasons-list position minus 8, checked at six points against our own war
history (`2025-03` = 118 through `2026-09` = 136). The in-game Pass number
(87) is not in the API anywhere; Merge Tactics counts its own
(`AutoChess_2026_Season_11`, not monthly). So the record's integer is a
derived name. The table below anchors on the month the API uses and
derives the war number from it, verifying against each new river race log
entry; the tools still speak every surface's own number.

**Evidence, clone.**

| Claim                                          | Number                                     |
| ---------------------------------------------- | ------------------------------------------ |
| battles with `season_id`                       | 9,526 of 217,978 (4.4%), all war types     |
| stamped battles whose `season_id` contradicts the first-Monday calendar | 3,230 of 9,526 (34%) |
| of those, imported (created_at > battle_time + 2d) | 3,228 |
| POAP KINGS war battles in Aug 2026 stamped S132 (a May season) | 1,234 |
| participants in today's 28-day meta window on the S135 side / S136 side | 51,362 / 309,766 |
| distinct players on each side                  | 25,684 / 75,011                            |

The 3,228 bad stamps came in through the 2026-09-15 elixir-bot backfill
(`docs/NOTES.md`, "Second elixir-bot backfill"), which brought its own war
keys. The schema accepted `(season_id 132, battle_time 2026-08-15)` because
nothing relates a season to a time range. `stampWarKeys` cannot heal them:
it revisits `season_id IS NULL` only (`war.mjs:516-523`), and every column
is `coalesce`-filled (`war.mjs:536-543`). These rows join `war_week` and
`war_participation` under S132 and are counted in `war_history` and
`clans_participation` for the wrong weeks.

**Fix (three migrations, all additive and instant).**

```sql
-- 01xx_season.sql
create table season (
  season_month     text primary key                    -- the API's own name (YYYY-MM): seasons list, leagueStatistics, PoL finals, progress keys
                   check (season_month ~ '^[0-9]{4}-[0-9]{2}$'),
  war_season_id    integer not null unique,            -- riverracelog seasonId: one per month from the anchor, verified per log entry
  pass_season      integer,                            -- in-game Pass "Season N": the one number not in the API; calendar-derived (2019-07 = 1), display only
  starts_at        timestamptz not null,               -- first Monday 10:00:00Z
  ends_at          timestamptz not null,               -- next season's starts_at (exclusive)
  sections         smallint not null check (sections in (4, 5)),
  colosseum_section smallint not null,
  war_id_verified_at timestamptz,                      -- when a riverracelog entry confirmed war_season_id
  check (ends_at > starts_at),
  check (colosseum_section = sections - 1),
  exclude using gist (tstzrange(starts_at, ends_at) with &&)
);
comment on table season is
  'One row per Clash Royale season, keyed by the month the API names it. war_season_id is the riverrace seasonId, a derived label confirmed by the next war log entry; pass_season is display only. Bounds are the calendar: first Monday 10:00Z to first Monday 10:00Z.';

-- A mode's own season key, taken verbatim from Player.progress and never
-- derived: Merge Tactics counts its own, 2v2 League and the seasonal
-- Trophy Road use the month. first/last seen are the observation.
create table mode_season (
  progress_key   text primary key,                     -- e.g. 'AutoChess_2026_Season_11', '2v2League_202609'
  mode           text not null,                        -- the key with its season part removed
  season_month   text references season,               -- set when the key carries YYYYMM; null for Merge Tactics
  first_seen_at  timestamptz not null,
  last_seen_at   timestamptz not null
);

-- seed: 2026-02 .. 2026-10 from seasonFromDate (war 129..137); the
-- scheduler upserts the next season on each rollover, and the riverracelog
-- projector sets war_id_verified_at when a log entry's seasonId matches;
-- a mismatch is an alarm, never a silent relabel. No column here is
-- observed: the bounds are the calendar the API confirms (the 10:00Z
-- countdown), and the per-race close instant lives on war_week (1.2).
```


The `season` row is the calendar the code already computes, made
queryable and joinable. Nothing else about a patch is stored. (The one
patch-shaped fact the API does emit, a catalog delta such as a new card id
or an elixir-cost change, is a losslessness question about the `card`
table, not a balance model; it sits in Tier 3, 3.7.)

**Where the season key lives.** The brief asks for a season key on the
battle or participant. Recommendation: **do not add one.** A battle's
season is a pure function of `battle_time`, `battle_participant.battle_time`
is already the leading column of the window index (0098/0100) and of the
player and clan covering indexes, and bounding a window by
`season.starts_at`/`ends_at` is the same range predicate the tools run
today. A stored `season_id smallint` on 562k participants would cost a
keyset-batched backfill (the 0099 shape, ~30 minutes on the micro), 2-4 MB
of heap, and a permanent write per row for no read that the range cannot
serve. Where a season *grain* is needed (the Tier 2 rollups) it is computed
at rollup time from the same function, keyed by `season_month`. The
same reasoning retires the war stamps on `battle` (1.2). The war tables
(`war_week`, `war_participation`, `war_attendance_day`, `war_week_clan`)
keep their integer key because that is the API's own key for that surface
(`riverracelog` speaks `(seasonId, sectionIndex)` and never the month) and
gain a reference to `season (war_season_id)`; renaming their `season_id`
to `war_season_id` is a cosmetic contraction for later.

**The tools: default window and the boundary rule.** Today
`battles_meta_cards`, `battles_meta_decks` and `cards_synergy` default to
`now() - 28 days` (`resolveWindow(ctx, args, {defaultDays: 28})`,
`battles.mjs:1089,1249`, `synergy.mjs:104`) and `applied.window` echoes
`{from, to, source: "default"}` with no season in it. Proposed contract
(minor bump, additive):

1. **Default = current season to date**, from `season.starts_at`.
   `applied.window` gains `season: {month, war, pass, starts_at,
   ends_at}` (one object, every surface's own number, so an agent can say
   "S136" to a clan and "Season 87" to a Pass player) and
   `source: "season"`. `rankings_timeline` and `game_events`
   already default this way (`rankings.mjs:628,787`); the meta tools join
   them.
2. **A `season` argument** on the three meta tools and `battles_trends`:
   `"current"` (default), `"previous"`, `YYYY-MM`, or an integer taken
   as the war number (the only integer the API speaks). It sets
   `from`/`to` from the row; `from`/`to`/`days`/`weeks` still win when
   given, as today.
3. **When the resolved window crosses a boundary**, whatever set it, the
   response says so in a structured field and a note. `applied.window`
   gains `crosses: [{kind: "season", at, from_season, to_season}]`
   (empty array when clean), and `notes` gains one sentence: *"Window
   spans S135 and S136; balance changes land on the season roll, so card
   values before and after are not one population. Pass season:'current'
   or split with from/to."* Nothing is refused: an agent asking across a boundary may
   mean it. The `crosses` field is what lets a consumer refuse for itself.
4. **When the current season is thin**, say it rather than widen it. On
   day 1 of a season the default window holds one day. The existing
   `insufficient_sample` mechanism (`segment_min_decided: 30`) already
   fires; add `season_age_days` to `applied.window` and a note that
   `season:'previous'` is the settled comparison. Never silently fall back
   to 28 days, which is how the boundary got crossed in the first place.
5. **`battles_trends`** groups by ISO week and already crosses seasons by
   design; it gets `crosses` (so a consumer can draw the line) and, per
   week row, `season_month`.

The default-window decision in numbers: on 2026-09-17 the 28-day window is
14% S135 rows. On 2026-10-05 (S137 roll) it would be 100% S136 for one day
and then decay. A rolling window is never season-clean; a season window is
clean by construction and exactly what the game itself reports (Path of
Legends boards, league stats, war logs are all per season).

**Cost.** `season` is under 20 rows and `mode_season` a few dozen.
Contract: minor (additive argument and fields). Ingest: the profile
projector upserts `mode_season` from `progress` keys; the scheduler gains a
once-per-season upsert. Risk: low; the only behaviour change is the default window, which
is the point.

### 1.2 War battles: derive the week and day from a master calendar, retire the stamps

**Finding.** The API stamps nothing on a war battle: a battlelog entry has
a `type` and a `battleTime`. Ingest tries to add what the API does not
give. `stampWarKeys` writes `season_id`, `section_index` and `war_day`
onto the `battle` row, only for battles inside 14 days, only when the
clan's next `currentriverrace` poll follows the battle, and only once
(`war.mjs:511-546`, coalesce-fill). Result on the clone: of 13,113
war-type battles, 10,000 (76%) carry no key (`riverRacePvP` 7,227 of
9,927, `riverRaceDuel` 1,293 of 2,160, `boatBattle` 1,773 of 1,972), and
3,230 stamped ones contradict their own `battle_time` (3,228 of them from
the 2026-09-15 elixir-bot import, which brought its own keys: 1,234 POAP
KINGS battles in August 2026 stamped S132, a May season). Nothing can heal
them: the stamper revisits `season_id IS NULL` only. `war_current`
attendance (`war.mjs:327-348`), `war_history` member weeks and
`clans_participation` all join `battle` on those columns, so three
quarters of the war battles the record holds are invisible to the war
readers, and some of the rest are filed under the wrong week.

**What the game's clock actually is, from the API across clans.** Probed
2026-09-17 on six clans in five countries (recorded in
`cr-agent-api-docs/clans.md`):

- The week key `(seasonId, sectionIndex)` and the live `periodIndex` are
  identical for every clan at the same instant (all six logs agree on
  `135.0`..`136.0`; three live races read `sectionIndex 1, periodIndex 10,
  warDay` at 12:00Z). The war calendar is global.
- The close *instant* is per race, drawn at the season roll and stable to
  the second within it: `09:34Z` for POAP KINGS in S135, `09:44Z`,
  `09:48Z`, `09:54Z`, `09:55Z`, `09:57Z` for the other five, all inside
  the `09:30Z`-`10:00Z` band before the 10:00Z policy hour, and all
  re-drawn at S136 (`09:38Z`, `09:39Z`, `09:44Z`, `09:46Z`, `09:47Z`,
  `09:47Z`). Our own `war_period_anchor` rows for POAP KINGS show the
  daily `periodIndex` flip first observed at 09:37Z, 09:40Z, 09:47Z on
  consecutive days, consistent with the clan's slot rather than the hour.
- The code already decided this (`war-clock.mjs:256-263`, Jamie
  2026-09-07): a multi-clan service follows the **policy grid**, 10:00Z,
  for every clan, so "war day 3" means one comparable window; a clan's own
  slot is an observation, not a clock. This review does not reopen that.

So a war battle's week and day are a pure function of `battle_time` on a
global grid, with one bounded caveat: a battle a clan plays between its
own slot and 10:00Z belongs to the new period in the game and to the old
period on the grid. That band is at most 30 minutes of each war day, it
runs in one direction (the grid is late, never early, because every
observed slot precedes the hour), and the record can say exactly which
battles sit in it because the clan's slot is in its own log.

**Fix.** A master `war_period` calendar, one row per period of every
season, seeded from `season` and the grid; readers resolve a battle by
range, and the three stamp columns on `battle` retire.

```sql
-- 01xx_war_period.sql  (instant; ~35 rows a season)
create table war_period (
  war_season_id  integer not null references season (war_season_id),
  period_index   integer not null,                     -- season-monotonic, as currentriverrace reports it
  section_index  smallint not null,                    -- period_index / 7
  day_in_section smallint not null,                    -- period_index % 7
  kind           text not null check (kind in ('training', 'war', 'colosseum')),
  war_day        smallint check (war_day between 1 and 4),
  starts_at      timestamptz not null,                 -- policy grid: 10:00Z
  ends_at        timestamptz not null,
  primary key (war_season_id, period_index),
  unique (starts_at),
  check (section_index = period_index / 7),
  check (day_in_section = period_index % 7),
  check ((kind = 'training') = (war_day is null)),
  exclude using gist (tstzrange(starts_at, ends_at) with &&)
);
comment on table war_period is
  'The policy grid, one row per river race period: days roll at 10:00Z, three training days then four war days per section, the last section of a season is colosseum. Global; a clan''s own close slot lives in war_week_clan.finish_time and riverracelog, not here.';

-- A clan's observed slot, from its own log: the API's createdDate for each
-- week it closed. Already implied by war_week.finished_observed_at (an
-- observation with polling latency); this is the API's own stamp.
alter table war_week add column closed_at timestamptz;   -- riverracelog[].createdDate, exact
```

A war reader then joins `battle_participant bp` (which carries `clan_tag`
and `battle_time`) to `war_period p on bp.battle_time >= p.starts_at and
bp.battle_time < p.ends_at`, and to the clan's `war_week` on
`(bp.clan_tag, p.war_season_id, p.section_index)`. Every war battle
resolves, including the 76% and the imported rows, with no stamp, no
14-day window and no dependence on which poll came first. The
`battle_unstamped_war` partial index and `stampWarKeys` retire with the
columns; `war_period_anchor` stays as the per-clan observation that would
reveal a grid change. Where the slot band matters (attendance on the last
war day, "decks used today" near the close), the reader can flag battles
with `battle_time` between `war_week.closed_at`'s time of day and 10:00Z
as `slot_band: true` rather than guess; that is a tool refinement, not a
schema one.

**Not overfitted to one clan, by construction.** Nothing in the table is
observed from POAP KINGS: the grid is the policy the code already applies
to every clan, the season bounds come from `season`, and the only per-clan
fact (`closed_at`) is each clan's own API stamp. The six-clan probe is the
evidence that the keys are global and that the per-clan part is the close
instant alone.

**Cost.** `war_period` is ~35 rows a season, seeded ahead by the scheduler
with the season. `war_week.closed_at` is one nullable column, filled by
the riverracelog projector from now on; the API's log holds ten weeks, so
recent history fills on the next poll and older weeks keep
`finished_observed_at` as their polling-latency bound. Dropping `battle.season_id`, `section_index`, `war_day` is
expand-and-contract: readers move first, the columns go in the contract
phase. Risk: the readers' war attribution changes for the 10,000 battles
that were invisible, which is the point, and for the imported 3,230, which
were wrong.

### 1.3 Foreign keys: three to add now, two to decline with numbers

**Add (0 orphans on the clone, so `NOT VALID` then `VALIDATE` is a scan
under `SHARE UPDATE EXCLUSIVE`, no rewrite):**

| Constraint                                            | Orphans | Rows scanned |
| ----------------------------------------------------- | ------- | ------------ |
| `battle_participant.deck_hash -> deck`                | 0       | 509,252      |
| `player_card.card_id -> card`                         | 0       | 165,460      |
| `war_participation (clan_tag, season_id, section_index) -> war_week` | 0 | 36,159 |
| `war_attendance_day (clan_tag, season_id, section_index) -> war_week` | 0 | 9,204 |
| `war_week_clan (clan_tag, season_id, section_index) -> war_week` | 0 | 1,715 |
| `war_week.season_id -> season (war_season_id)`, `war_participation.season_id` likewise, `war_week (season_id, section_index) -> war_period`, `ranking_presence`/`ranking_snapshot` after 1.5 | 0 | small |

```sql
alter table battle_participant
  add constraint battle_participant_deck_fk foreign key (deck_hash) references deck not valid;
alter table player_card
  add constraint player_card_card_fk foreign key (card_id) references card not valid;
alter table war_participation
  add constraint war_participation_week_fk
  foreign key (clan_tag, season_id, section_index) references war_week not valid;
-- ... then, next deploy:
alter table battle_participant validate constraint battle_participant_deck_fk;
```

Ingest already writes `deck` before the participant in the same
transaction (`deck-cards.mjs:110` before `battles.mjs:436`) and stubs a
`card` before any `player_card`, so the constraints cannot pause it. The
war ones are safe because `war_week` is upserted first in
`projectRiverRace` (`war.mjs:107`).

**Decline, with the reason recorded:**

- `battle_participant.clan_tag -> clan`: 176,881 participant rows name
  100,628 clans not in `clan` (6,457 rows). Honouring the FK means
  upserting the opponent's clan on every battle (up to two `clan` upserts
  per battle, 20k battles a day) to grow `clan` fifteen-fold for rows no
  reader wants: `clan_tag` on a participant is a filter for *our* clans'
  timelines (`battle_participant_clan_time`), never a join to a clan row.
- `ranking_entry.clan_tag -> clan`: 428,083 of 728,405 entries name clans
  we do not record. A board entry's clan is a label, not a subject.

Both should be documented on the column (`comment on column ... 'API tag,
not a reference; see review 2026-09-16 §1.3'`) so the question is not
re-asked.

### 1.4 NOT NULL where the code assumes presence

| Column                               | Nulls (clone) | Readers that dereference                   |
| ------------------------------------ | ------------- | ------------------------------------------ |
| `battle_participant.battle_time`     | 0 of 509,252  | every window read; `describeBattle` calls `.toISOString()` |
| `battle_participant.type`            | 0             | `bp.type = any(...)` in five meta reads    |
| `deck.card_count`                    | 1 row at 0    | the identity-of-nothing 0093 nulled from participants but left in `deck` |

```sql
-- No rewrite: a NOT VALID check, validated in a scan, lets SET NOT NULL skip its own scan (PG 12+).
alter table battle_participant add constraint bp_battle_time_nn check (battle_time is not null) not valid;
alter table battle_participant validate constraint bp_battle_time_nn;
alter table battle_participant alter column battle_time set not null;
alter table battle_participant drop constraint bp_battle_time_nn;
-- same for type
delete from deck where card_count = 0;   -- one row, no participant references it (0093)
alter table deck add constraint deck_card_count_check check (card_count > 0);
```

`battle_participant.type_class` is already `not null default 'pvp'`
(0095) while `type` was left nullable on purpose (0099: "a row without it
matches no type filter rather than lying with a default"). Both copies come
from the same source column; now that the backfill is complete the honest
state is `NOT NULL, no default` on both. Dropping the `'pvp'` default on
`type_class` is the smaller half of that.

`player_snapshot_daily.observed_at` is null on 2,995 of 14,665 rows
(pre-0038 imports); the readers guard it (`observed_at is not null`) and
should keep doing so. Leave it.

### 1.5 Our enums that the schema leaves open

The API's enums stay open by decision (`battle.type`,
`clan_membership.role`, `card.rarity`): recorded. These are ours, written
from fixed literal sets, and open:

| Column                                 | Literal set in code                                                                                                                                                                  | Rows   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| `player_event.event_type`              | 10 kinds (`events.mjs:22-31`), 14 values seen incl. `legendary_badge_earned`                                                                                                          | 13,962 |
| `clan_event.event_type`                | 6 kinds (`events.mjs:12-20`)                                                                                                                                                          | 11,962 |
| `player_daily_battle_rollup.mode_group`| `ladder, ranked, casual, war, challenge, tournament`                                                                                                                                  | 240k   |
| `poll_state.hint`                      | **two vocabularies in one column**: `active/idle/asleep` on clan rows (`pipeline.mjs:213`), the API's `training/warDay/colosseum` on riverrace rows (`pipeline.mjs:357`)              | 4,637  |
| `ranking_snapshot.season_id`           | text; integers for pol/clans/mode boards, the *relabelled* backward extrapolation for `pol_final` (0070), ordered with `season_id::int` (`rankings.mjs:132`)                          | 1,266  |
| `war_period_anchor.period_index`       | `0..34` by the grid; no check                                                                                                                                                         | 144    |

Add `check (event_type in (...))` on both event tables (the timeline reads
an allowlist, `entries.mjs:75-110`, so an unknown kind is already invisible
and should fail at write instead). For `poll_state.hint`, split:
`hint` keeps ours with a check; a new nullable `period_type text` takes the
API's value with no check (API enum). `ranking_snapshot.season_id` becomes
`season_month text references season` (the finals already carry it since
0070; the pol/clans/mode boards take the month their `observed_at` falls
in), 1,266 rows, done as add-column + fill + swap to keep the rule; the
`season_id::int` ordering in `rankings.mjs:132` becomes an ordinary text
order because `YYYY-MM` sorts.

### 1.6 A snapshot kind that says "season" and means "Monday"

**Finding.** `player_snapshot_daily.snapshot_kind = 'season_roll'` is
written in the hour before the **weekly donation reset** (Monday 00:10Z),
not the season roll: `inPreResetWindow()` in `packages/contracts/src/season.ts:31`
wraps `nextDonationResetMs`, and the file's own header says "the weekly
window is the one that matters". The 996 rows sit on Sundays and Mondays
(09-06: 257, 09-13: 659). No reader distinguishes the kind except as an
`order by snapshot_kind desc` tiebreaker (six lateral limit-1 reads) and
`= 'daily'` filters.

**Fix.** Rename the value to `pre_reset` (a 996-row update, instant) and
widen the check to `('daily', 'pre_reset', 'season_roll')`, reserving the
third for a real season-roll snapshot taken in the hour before
`season.ends_at`, which is the observation that captures
`leagueStatistics.currentSeason` before it becomes `previousSeason`
(`cr-agent-api-docs/players.md:64-84`) and the last Path of Legends
standing before the reset. That row is the one `players_timeline` should
mark as the season line.

### 1.7 Dead columns and never-written flags (drop, all instant)

| Column                                                                                   | Evidence                                                                                 |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `battle.modifiers jsonb`                                                                 | `modifiers: null` hard-coded (`battles.mjs:185`); null on all 217,978 rows; the API puts modifiers on the *participant* (`models/battles.md:181-189`) |
| `war_attendance_day.finalized`                                                           | never written; returned to callers by `clans_participation` (`clans.mjs:585`) as a permanent `false` |
| `player_daily_battle_rollup.expected_battle_delta`, `completeness_ratio`, `is_complete`  | retired by 0057, never written, null on 225,313 rows                                     |

If modifiers are wanted later they belong on `battle_participant` (or a
`battle_participant_modifier` row per value), where the API carries them.

---

### 1.8 JSON columns become columns and rows (Jamie, 2026-09-17: "do it right")

Every JSON column in the schema was censused for what writes it and what
reads it. Two are correct as JSON by policy and stay: `api_payload.payload_json`
(the raw payload cache, tools never read it) and `mcp_call_audit.args`
(captured call arguments, diagnostics). Three are free-form diagnostics
and stay: `api_receipt.admission_errors` (becomes `text[]`),
`feedback.context`, `account_event.detail`, `magic_login.context`/`started_from`.
Everything else has a fixed shape and a reader, and becomes typed columns
or child rows:

| Column                                          | Shape today                                                                          | Becomes                                                                                                                                                                                                                                                                              | Rows      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| `player_snapshot_daily.lifetime`                | `{battleCount, wins, losses, threeCrownWins, starPoints, expPoints, collectionLevel}` | seven integer columns                                                                                                                                                                                                                                                                | 14,665    |
| `player_snapshot_daily.pol`                     | `{current: {leagueNumber, trophies, rank}, best: {...}}`                              | six integer columns `pol_league`, `pol_trophies`, `pol_rank`, `pol_best_league`, `pol_best_trophies`, `pol_best_rank`                                                                                                                                                                | 14,665    |
| `player_snapshot_daily.league_stats`            | `{currentSeason: {trophies, bestTrophies}, previousSeason: {id, rank, trophies, bestTrophies}, bestSeason: {id, trophies, rank}}`; a JSON scalar `null` on 6,150 rows | `season_trophies`, `season_best_trophies`, `prev_season_month references season`, `prev_season_rank`, `prev_season_trophies`, `prev_season_best_trophies`, `best_season_month references season`, `best_season_trophies`, `best_season_rank` | 14,665    |
| `battle_participant.tower_hp`                   | `{king: int, princess: [int, int]}`, destroyed towers omitted                        | `king_tower_hp smallint`, `princess_tower_hp_1 smallint`, `princess_tower_hp_2 smallint` (0 = destroyed; the API gives no left/right, so slot order is the array's)                                                                                                                  | 509,252   |
| `card.icon_urls`                                | `{medium, evolutionMedium?, heroMedium?}`                                             | three text columns; presence of the evolution and hero URLs already encodes the `max_evolution_level` bits (`cr-agent-api-docs/cards.md`)                                                                                                                                             | 128       |
| `player_event.payload`                          | one of 10 fixed shapes, keys censused in Appendix D                                   | typed nullable columns on the row: `card_id references card`, `badge_name`, `level`, `prior_level`, `max_level`, `arena_from references arena`, `arena_to references arena`, `league_from`, `league_to`, `value_before`, `value_after`, `step`, `battle_id references battle` (the promoting or crossing battle, today nested as `promoted_by`/`crossed_by`) | 13,962    |
| `clan_event.payload`                            | one of 6 fixed shapes                                                                | `player_tag references player`, `role_before`, `role_after`, `roster_size_before`, `roster_size_after`, `war_season_id`, `section_index`, `fame`, `rank`, `trophy_change`; `bracket_observed`'s five rivals are already rows in `war_week_clan` and drop from the payload             | 11,962    |
| `player_activity.rhythm`                        | 168 floats                                                                           | `real[168]`, a typed array, not JSON                                                                                                                                                                                                                                                  | 830       |
| `player_activity.days`                          | `{"YYYY-MM-DD": [battles, wins, losses]}`                                            | **nothing**: it is `player_daily_battle_rollup` summed over mode, the table with no reader (2.4); `battle-activity.mjs` reads the rollup                                                                                                                                              | 830       |
| `player_activity.not_recorded_days`             | sorted array of dates                                                                | `player_not_recorded_day (player_tag, day)` rows, or `date[]`                                                                                                                                                                                                                        | 830       |
| `oauth_client.redirect_uris`                    | JSON array of strings                                                                | `text[]`                                                                                                                                                                                                                                                                             | small     |

What it buys beyond "right": the event ledger's card, battle and arena
become foreign keys instead of copied names (a `card_leveled` row then
cannot name a card the catalog lacks, and the timeline's "Lava Hound
unlocked Lava Hound" class of bug, contract 3.9.0, becomes structurally
impossible); the snapshot's previous and best season become references to
`season`; and `league_stats`'s scalar-null trap (`jsonb_typeof` guards in
every walker) disappears.

**Shape of the change.** Expand-and-contract, per table: add the nullable
columns (instant); the projector writes both for one deploy; a batched op
fills history; readers move; the JSON column drops. The only table where
the fill is real work is `battle_participant` (509k rows, the 0099 shape:
10k-row batches, ~30 minutes on the micro, no lock held across batches);
`player_snapshot_daily` and the two event tables fill in seconds and can
do so inside the migration. `players_profile` and the timeline render
their objects from the columns; the contract is unchanged.

**Cost.** Participant heap grows ~6 bytes a row and loses the jsonb
(net smaller: the JSON keys are repeated 509k times today). Event tables
gain ~12 sparse nullable columns each; PostgreSQL stores a null in the
bitmap, so a row carries only its kind's values. Risk: low; every shape
above was read from the writer that produces it, and the census in
Appendix D is the key list.

## Tier 2: do soon (rollups and aggregates, grain decided)

The live call mix (7 days to 09-17): `battles_meta_cards` 80 calls, avg
6.9 s, p95 18.2 s, 9 `query_timeout`; `battles_meta_decks` 49 calls, avg
9.6 s, 6 timeouts; `cards_synergy` 13 calls, avg 9.6 s;
`clans_participation` 51 calls, avg 8.5 s; `battles_levels` avg 4.6 s;
`clans_pilot_scores` avg 9.8 s; `clans_standings` avg 2.1 s. Everything
else averages under 1 s. The slow class is exactly the whole-window
aggregate class, and every one of them is computed from raw
`battle_participant` rows on every call. **No tool reads a rollup today.**
`player_daily_battle_rollup` is rewritten (delete + reinsert per player-day)
on every battle ingest and has no reader outside its writer.

Why they are slow, from `{explain_meta}` on live and the same shape on the
clone:

- The corpus card meta (13.2 s on the clone, 8.0 s live warm) is a
  parallel seq scan of the participant heap (20-34k buffers read) feeding
  a `(deck_hash, player_tag)` group of 141,879 pairs that **spills**:
  `work_mem` is 4 MB, the sort is an external merge over 11 MB per worker,
  37k temp blocks read and written. Then 1.4M `deck_card` rows are joined.
- The corpus prior (`corpusPrior`, `shared.mjs:742`) is a second full scan
  of the same rows on every scoped call (875 ms, 20,441 buffers read), so a
  clan-scoped meta pays for the corpus it excludes.
- A season bound instead of 28 days saves only 18% (10.8 s): the work is
  the group-by and the join, not the range.

### 2.1 `card_meta_season`: per season, per mode group, per card form

**Grain.** `(season_month, mode_group, card_id, form)` with
`battles, wins, losses, players, refreshed_at, through_battle_time`.
`mode_group` is the contract's six-way group (`modes.ts`), which is what
the tools filter by (`mode` argument), not the 12 raw types. Measured on
the clone: 3,326 rows for two seasons at raw-type grain, so ~1,200 rows
per season at mode-group grain. Trivial.

**Distinct players, honestly.** Distinct players do not sum across days:
for Knight in S136 pvp the window-distinct count is 12,330 while the sum of
daily distincts is 14,650 (+19%). So `players` cannot be incremented; it is
recomputed. The design that stays honest on a micro:

- **Counters (`battles`, `wins`, `losses`) increment hourly** from rows
  inserted since the last `through_battle_time` cursor (`battle.created_at`
  is indexed, 0001; a battle's cards are reachable by pk prefix). Sums are
  exact.
- **`players` is recomputed nightly for the current season only**, as one
  `count(distinct player_tag)` per (mode_group, card, form) over that
  season's rows. That is today's 11 s corpus query run once a night
  instead of 80 times a week, and past seasons freeze the day after they
  end (their row gets `final = true`).
- A row's `players` is therefore up to a day stale; the tool says so
  (`meta.completeness_note` already exists for this).

**What it fixes.** Corpus card meta 13 s (and the 9 `query_timeout`s):
becomes a 1,200-row read. The shrinkage prior per (season, mode) is the
same table's totals, so the clan-scoped meta loses its 875 ms corpus scan
too (clan card meta 2.5 s -> ~1.6 s, the remainder being the member rows,
which stay raw and are cheap through the covering index).

**Refresh shape.** Both live in `services/jobs` beside
`activity_histogram`: the hourly increment, and a nightly run that
recomputes the current season and, on the same pass, builds any season
that has rows but no `final` rollup yet, so the backfill of past seasons
is the first few nights of the job rather than an operator's invocation.
A `{meta_rollup}` migrate op exists only as the manual re-run for a
repair. Ingest is untouched: no write amplification
on the battle transaction (an increment per played card would be 16
upserts per battle).

```sql
create table card_meta_season (
  season_month text not null references season,
  mode_group  text not null check (mode_group in ('ladder','ranked','war','casual','challenge','tournament')),
  card_id     integer not null references card,
  form        smallint not null default 0 check (form between 0 and 3),
  battles     integer not null default 0,
  wins        integer not null default 0,
  losses      integer not null default 0,
  players     integer,                       -- null until the first nightly recompute
  players_as_of timestamptz,
  through_battle_time timestamptz not null,  -- the hourly cursor
  final       boolean not null default false,
  primary key (season_month, mode_group, card_id, form)
);
```

### 2.2 `deck_meta_season`: per season, per mode group, per deck

**Grain.** `(season_month, mode_group, deck_hash)` with `battles, wins,
losses, players, first_used, last_used`. Clone: 121,813 distinct
`(season, type, deck_hash)` since 08-03 at raw-type grain, so ~80-100k
rows per season at mode-group grain, ~12 MB heap + ~8 MB index per season.
Same refresh split as 2.1 (counters hourly, `players` nightly). `deck`
itself stays identity-only (`first_seen_at`/`last_seen_at` already there).

**What it fixes.** Corpus deck meta 4.7 s -> a filtered index read
(`where season_month = $1 and mode_group = $2 order by battles desc limit
$3`, needs `(season_month, mode_group, battles desc)`), and the 6 timeouts.
`battles_query` `deck_stats` (an unbounded `count(distinct player_tag)` per
deck, `battles.mjs:427-437`) reads its per-season rows instead.

### 2.3 `card_pair_season`: synergy without the anchor subquery

**Grain.** `(season_month, mode_group, card_a, form_a, card_b, form_b)` for
`card_a < card_b`, with `co_battles, wins, players`. Clone: 16,371
distinct pairs in S136's decks, so ~20k rows per season per mode group.
Nightly recompute only (the pair explosion is 28 rows per deck; an hourly
increment is not worth it at 13 calls a week). `cards_synergy` becomes a
join of this table to `card_meta_season` (the baseline). Fixes synergy
9.5 s -> ms, at the cost of the day-old `players` caveat.

### 2.4 The daily player rollup: wire it or drop it

`player_daily_battle_rollup` (`player_tag, day, mode_group, game_mode_id`)
is the right grain for the count-shaped reads and is already maintained.
Either:

- **Wire it**: `clans_standings` (whose CTE `s`, `clans.mjs:97-104`, scans
  the corpus-wide 30-day participant set and discards all but the ~50
  members in the outer join), `battles_trends`, `battles_performance`'s
  totals, `players_summary`'s 30-day counters and `first-answer.mjs` all
  sum `wins/losses/draws/crowns/trophy_delta` from it and touch raw rows
  only for streaks, last-N and deck identity. The `game_mode_id` key stays
  because `battles_performance` groups by mode.
- **Or drop it**, following `clan_daily_metrics` (0094), and save the
  delete+reinsert on every ingest (771k inserted, 577k deleted to keep
  240k rows, per `{tables}`).

Recommendation: wire it, because 2.1-2.3 give the corpus its rollups and
this one is the per-player equivalent the war and standings readers want,
and add a season key to nothing: a day maps to a season through `season`.

### 2.5 Not needed as new tables

- **Per-clan per-week war summary**: `war_week_clan` + `war_participation`
  already are it, keyed `(clan_tag, season_id, section_index)`. What they
  lack is the FK to `war_week` (1.3) and the battles the stamper misses (1.2).
- **Per-player per-season summary**: a sum over `player_daily_battle_rollup`
  joined to `season`; not worth a table until a reader asks at that grain.
- **The corpus prior per (season, mode)**: 2.1's totals.

### 2.6 Two cost lines that are not schema

- **`work_mem` is 4 MB** on the micro and every meta query spills. Setting
  `set local work_mem = '32MB'` inside the meta handlers' transaction is
  free until 2.1-2.3 land and removes the external merge (37k temp blocks
  on the clone run). Not a schema change; recorded because the plans show
  it.
- **db.t4g.small** (2 GB RAM, shared_buffers ~180 MB) at about **$12 a
  month more** doubles the cache against a 3.6 GB database whose hot set
  (participant heap 169 MB + its 612 MB of indexes + `deck_card` 534 MB) is
  larger than the buffer pool. The rollups above make this unnecessary for
  the meta reads; it remains the lever for `battles_levels` and
  `clans_pilot_scores` (a 90-day corpus temp table per call, avg 4.6-9.8 s)
  if those stay raw.

---

## Tier 3: consider (normalization with a read behind it)

### 3.1 and 3.2: folded into 1.8

The JSON items moved to Tier 1 (1.8) on Jamie's read: every one has a
fixed shape the code already knows, so columns are the right size of
change, not a cleanup.

### 3.3 The participant's copied columns: the set is right, one more is not needed

`battle_time`, `clan_tag`, `type_class`, `type` on the participant are read
by 18, 5, 6 and 6 tools respectively as filters, and the drift check
(`bp.x is distinct from b.x`) is 0 on all three copied columns. The next
hottest filter that still joins `battle` is `game_mode_id`/`game_mode_name`
(`battles_query`, `battles_performance` group-by-mode) and `arena`. Neither
is worth copying: `battles_query` joins `battle` for the row anyway, and
mode grouping reads one player's rows.

The read-side inconsistency is worth a line in the tools, not the schema:
`battles_performance` filters `b.battle_time` in one path and
`bp.battle_time` in another (`battles.mjs:586,681`), and `battles_trends`
filters `bp.` but groups on `b.`, forcing the join the other meta tools
avoid. Every window predicate should be `bp.battle_time`, which is what the
window and covering indexes are on.

### 3.4 The participant's indexes: 612 MB of index on 169 MB of heap

Seven indexes; the two largest overlap: `battle_participant_player_time_cover
(player_tag, battle_time desc) include (...)` 118 MB and
`battle_participant_player (player_tag, battle_id)` 58 MB, and
`battle_participant_deck_time (deck_hash, battle_time desc) include (...)`
64 MB beside `battle_participant_deck (player_tag, deck_hash)` 26 MB. Once
2.1-2.3 take the corpus reads, `battle_participant_window` (65 MB, the
whole-window covering index from 0098/0100) has no reader left and can go.
Candidates to drop after a week of `pg_stat_user_indexes.idx_scan` says so:
`battle_participant_player` (the cover index answers `(player_tag,
battle_id)` lookups) and `battle_participant_window`. Saves ~120 MB of the
cache's competition.

### 3.5 Small integrity items

- `player_snapshot_daily.arena_id -> arena`: 6 orphan rows, all
  `54000001` (Training Camp), which never appears on a battle so the
  battle-fed catalog never learned it. Seed the row; add the FK.
- `api_receipt.job_id -> job`: 10,284 receipts (09-06..09-09) reference
  jobs the sweep deleted. Either `references job on delete set null` (a
  sweep then nulls, cheap) or accept and comment. Choose the FK: a receipt
  that says "job 123" for a job that no longer exists is a false pointer.
- `poll_state.subject_tag` is polymorphic: 356 rows are board and catalog
  keys (`rankings_pol` 263, `leaderboard` 30, ...), not tags. Rename to
  `subject_key` with a comment; no FK is possible and none should be
  implied by the name.
- `game_event` is the game's `/events` calendar, correctly named but easy
  to mistake for a domain-event table beside `player_event`/`clan_event`.
  A comment suffices.
- `ranking_board` receives `on conflict do update set label = ranking_board.label`
  on every board fetch (`rankings.mjs:141`): a self-assignment that writes
  a tuple version. Add `where false` or drop the update.

### 3.6 Partial-index candidates, to confirm with `pg_stat_statements`

`clan_membership ... where left_observed_at is null` filtered by
`clan_tag` appears in ~16 queries; the pkey scan for POAP KINGS reads 158
rows to keep 46. A partial index `(clan_tag) where left_observed_at is
null` is ~1 MB. The six `order by snapshot_date desc, snapshot_kind desc
limit 1` lateral reads on `player_snapshot_daily` use the pkey and are
fine.

### 3.7 Catalog history (optional, not a balance model)

The cards projector overwrites a `card` row when the catalog moves
(`cards.mjs:52-72`, "newer-and-distinct"), so the prior `elixir_cost`,
`max_level` or `max_evolution_level` is lost, and a new card's arrival is
only `first_seen_at`. That is the one patch-shaped fact the API emits by
itself. If it is ever wanted, an append-only
`card_catalog_change (card_id, observed_at, field, before, after)` written
by the same projector keeps it, with no hand feeding. It is not a balance
model and must not be presented as one; no tool needs it today, so it is
here only so the losslessness gap is on record.

---

## Sequenced plan

Each line is one migration unless it says op. "Instant" means the ALTER
holds its lock for milliseconds; nothing here rewrites a large table.

| #   | Change                                                                                                      | Kind                                         | Contract |
| --- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------- | -------- |
| 1   | `season` (keyed `season_month`, `war_season_id` derived and log-verified) + `mode_season`; seed 2026-02..2026-10; scheduler upserts on rollover | instant (create table)  | none     |
| 2   | (withdrawn: balance changes are not modelled, Jamie 2026-09-17; the catalog-history item is 3.7, optional) | -                                            | -        |
| 3   | Meta tools: default window = current season; `season` argument; `applied.window.season` and `crosses`; the boundary note | code                              | **minor** (3.10) |
| 4   | `war_period` calendar + seed; `war_week.closed_at`, filled by the riverracelog projector for the weeks the API still serves (its log holds ten); older weeks stay null | instant | none |
| 5   | War readers (`war_current`, `war_history`, `clans_participation`, timeline) resolve battles by `war_period` range + `bp.clan_tag`; `stampWarKeys` stops writing | code | none (same fields; attribution corrected) |
| 6   | Drop `battle.season_id`, `section_index`, `war_day` and `battle_unstamped_war` once no reader names them      | instant                                      | none     |
| 7   | Closing FKs `not valid`: participant->deck, player_card->card, three war tables->war_week                    | instant                                      | none     |
| 8   | `validate` the five; NOT NULL on `battle_participant.battle_time`/`type` via check-then-set; drop the `type_class` default; delete the empty deck + `card_count > 0` | scans, no rewrite | none |
| 9   | CHECKs on `player_event.event_type`, `clan_event.event_type`, `rollup.mode_group`; `poll_state.period_type` split; `ranking_snapshot.season_id` -> `season_month` FK (add, fill 1,266 rows, swap) | instant + tiny fill | none |
| 10  | `snapshot_kind`: `season_roll` -> `pre_reset` (996 rows); widen check; real season-roll snapshot in the hour before `season.ends_at` | instant + 996-row update | none (internal) |
| 11  | Drop `battle.modifiers`, `war_attendance_day.finalized`, the three rollup completeness columns; `clans_participation` stops returning `finalized` | instant | **minor** (field removed from a response: treat as minor with a changelog line, since it was never true) |
| 12  | `card_meta_season`, `deck_meta_season`, `card_pair_season`; nightly job recomputes the current season and fills missing past seasons itself; hourly counters in jobs | instant create; the first nights do ~11 s per past season on the micro | none |
| 13  | Meta tools read 12; `corpusPrior` reads its totals; `set local work_mem` in the meantime                     | code                                         | none (same fields, faster; `players_as_of` added: minor) |
| 14  | Wire `player_daily_battle_rollup` into `clans_standings`, `battles_trends`, `players_summary`, `first-answer`  | code                                         | none     |
| 15  | 1.8: JSON to columns and rows, table by table (snapshot, events, card, activity in the migration; participant `tower_hp` by batched op)  | instant + one batched op                     | none     |
| 16  | Index diet on `battle_participant` after a week of `idx_scan` evidence; `clan_membership` partial index       | `drop index concurrently` / `create index concurrently` | none |
| 17  | `arena` seed + FK; `api_receipt.job_id` FK `on delete set null`; `poll_state.subject_tag` -> `subject_key`; comments on the two declined FKs | instant | none |

Items 1-3 are the season model and can ship together as one contract bump.
Items 4-6 must be in that order across two deploys (the columns cannot go
until the readers have moved). Item 12 is the only one that needs an op with real
run time, and it is read-only against the canonical tables.

---

## Appendix A: orphan census (clone, 2026-09-17)

Every column that names another table's key without a constraint, with the
anti-join count:

| Referrer -> referent                                          | Orphans | Note                                  |
| ------------------------------------------------------------- | ------- | ------------------------------------- |
| `battle_participant.deck_hash -> deck`                        | 0       | pending FK, add                       |
| `battle_participant.player_tag -> player`                     | 0       | FK exists                             |
| `battle_participant.clan_tag -> clan`                         | 176,881 (100,628 clans) | decline              |
| `battle_participant.clan_tag` null                            | 66,758  | clanless opponents                    |
| `player_card.card_id -> card`                                 | 0       | pending FK, add                       |
| `battle_participant_card.card_id -> card`                     | 0       | FK exists                             |
| `deck_card.card_id -> card`, `deck.tower_troop_id -> card`    | 0       | FK exists                             |
| `war_participation / war_attendance_day / war_week_clan -> war_week` | 0 | add                                |
| `war_week_clan.participant_clan_tag -> clan`                  | 1,084 (328 clans) | rivals; decline like 1.3    |
| `clan_membership.* -> player/clan`                            | 0       | FK exists                             |
| `ranking_entry.clan_tag -> clan`                              | 428,083 | decline                               |
| `clan_ranking_entry.clan_tag -> clan`                         | 0       | add (cheap, 35,974 rows)              |
| `player_snapshot_daily.arena_id -> arena`                     | 6       | Training Camp missing                 |
| `player_snapshot_daily.favorite_card_id -> card`              | 0       | add                                   |
| `api_receipt.job_id -> job`                                   | 10,284  | sweep victims                         |
| `claim_challenge.proof_battle_id -> battle`                   | 0       | add                                   |
| `recording.subject_tag`, `collection_member.subject_tag`      | 0       | polymorphic (player or clan)          |
| `poll_state.subject_tag`                                      | 356     | board keys, not tags                  |
| `battle.season_id -> (no table; a stamp the API never gave)`   | 3,230 contradict `battle_time`; 76% of war battles unstamped | 1.2, retire |

## Appendix B: enum census (clone)

`battle.type`: pathOfLegend 91,401; trail 69,990; PvP 35,193;
riverRacePvP 9,927; friendly 3,640; riverRaceDuel 2,160; boatBattle 1,972;
clanMate 1,156; tournament 1,137; riverRaceDuelColosseum 1,054;
clanMate2v2 235; unknown 113. `type_class`: pvp/boat, no others.
`outcome`: win 254,475; loss 254,503; draw 274. `clan_membership.role`:
member 17,222; elder 6,147; coLeader 4,040; leader 844. `snapshot_kind`:
daily 13,669; season_roll 996. `player_event.timing`: 33 exact, 13,929
estimated. `deck.card_count`: 8 -> 165,809; 12 -> 527 (boat-defence lists);
4 -> 29; 0 -> 1.

## Appendix C: timings used above

| Query                                                             | Where       | Time    | Notes                                                  |
| ----------------------------------------------------------------- | ----------- | ------- | ------------------------------------------------------ |
| corpus card meta, 28 days                                         | clone       | 13.2 s  | parallel seq scan; external merge sort; 37k temp blocks |
| corpus card meta, current season                                  | clone       | 10.8 s  | same shape, 18% fewer rows                             |
| corpus card meta, 28 days                                         | live (warm) | 8.0 s   | `{explain_meta}`, temp 31k blocks                      |
| corpus prior                                                      | live        | 0.9 s   | 20,441 buffers read                                    |
| clan deck aggregate (POAP KINGS)                                  | live        | 28 ms   | index-only via the player cover index                  |
| clan card aggregate                                               | live        | 1.3 s   | deck_card pk probes, 1,877 reads                       |
| excluded breakdown (clan)                                         | live        | 2.2 s   | the `battle` join, 5,129 reads; 0100 made it participant-only |

## Appendix D: event payload key census (clone)

`player_event.payload` keys by kind: `arena_changed` {from, to, to_name,
promoted_by?}; `badge_earned` {name, level, prior_level?};
`best_trophies_band` {best, band?, crossed_by?}; `card_leveled` {card_id,
name, rarity, level, prior_level}; `card_unlocked` {card_id, name, rarity};
`career_wins_step` {wins, step?, crossed_by?}; `collection_level_step`
{level}; `donation_reset` {donations_before, donations_after};
`legendary_badge_earned` {name}; `ranked_promotion` {from, to,
promoted_by?}. `promoted_by`/`crossed_by` nest {battle_id, battle_time,
type, opponent, crowns, crowns_against, trophy_change, trophies_after,
arena_floor}, all of which the battle row already holds.

`clan_event.payload` keys by kind: `member_joined` {player_tag, name,
role, roster_size_before, roster_size_after}; `member_left` {player_tag,
name?, role_at_departure, joined_observed_at, roster_size_before,
roster_size_after}; `role_changed` {player_tag, name, role_before,
role_after, direction?, roster_size_before, roster_size_after};
`week_resolved` {season_id, section_index, is_colosseum, fame, rank,
trophy_change}; `bracket_observed` and `race_finished` (added 3.9.0, not
yet on the clone) carry {season_id, section_index, rivals[]} and
{season_id, section_index, fame, finish_time}.
