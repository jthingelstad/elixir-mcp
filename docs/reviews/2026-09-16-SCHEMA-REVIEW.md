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

Nothing learned here about the game or its API was new to
`cr-agent-api-docs`; no push to it is owed by this review.

## The one-paragraph verdict

The canonical tables are sound: every denormalized copy on the participant
agrees with its source (0 drift rows across 509k), every card row resolves
to the catalog, and the pending closing foreign keys would validate today
with zero orphans. The model's real gap is **time**. The game runs on a
calendar (seasons, balance patches, war weeks) and the schema holds none of
it as rows: the season is a constant in `war-clock.mjs`, 95% of battles
carry no season, the 5% that do include 3,230 stamps that contradict their
own `battle_time`, and the meta tools default to a rolling 28 days that
today mixes two seasons 14/86 without saying so. Fixing that is Tier 1 and
is also what makes the Tier 2 rollups possible, because a rollup needs a
grain that the game itself resets.

---

## Tier 1: do next (correctness and domain fit)

### 1.1 The season and the balance change become rows

**Finding.** No `season` table exists. `seasonFromDate()` counts months
from a hard-coded anchor (`SEASON_ANCHOR = {id: 135, startMs:
2026-08-03T10:00Z}`, `services/ingest/src/war-clock.mjs:75`); `gameClock()`
returns `season_started_at`/`season_ends_at` by arithmetic. Every season
fact in the database (`battle.season_id`, `war_week.season_id`,
`ranking_snapshot.season_id`, `ranking_presence.season_id`) is an integer
that only code can turn into a date range, and nothing can validate it.
There is no balance-change table at all; the API offers none
(`cr-agent-api-docs`: a repo-wide search for balance/patch/version finds
only the level-cap note), so the only patch signal the record could carry
is one we feed it.

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
  season_id        integer primary key,               -- the war-season number the record files under
  season_month     text not null unique                -- the API's own name (YYYY-MM): league seasons, PoL finals
                   check (season_month ~ '^[0-9]{4}-[0-9]{2}$'),
  starts_at        timestamptz not null,               -- first Monday 10:00:00Z
  ends_at          timestamptz not null,               -- next season's starts_at (exclusive)
  sections         smallint not null check (sections in (4, 5)),
  colosseum_section smallint not null,
  source           text not null default 'calendar'
                   check (source in ('calendar', 'observed')),
  observed_race_close_at timestamptz,                  -- the ~09:34Z race close, when we saw it
  check (ends_at > starts_at),
  check (colosseum_section = sections - 1),
  exclude using gist (tstzrange(starts_at, ends_at) with &&)
);
comment on table season is
  'One row per Clash Royale season. season_id is the riverrace seasonId namespace; season_month the /locations/global/seasons name. Bounds are calendar-derived (first Monday 10:00Z) unless source = observed.';

-- seed: S129 (2026-02-02) .. S137 (2026-10-05), from seasonFromDate; the
-- scheduler upserts the next season on each rollover and stamps
-- observed_race_close_at when currentriverrace goes 404 (clans.md:333-346).
```

```sql
-- 01xx_balance_change.sql
create table balance_change (
  patch_id     text primary key,                       -- e.g. '2026-09-01', or the announced version
  effective_at timestamptz not null,
  season_id    integer not null references season,
  kind         text not null check (kind in ('season_patch', 'hotfix', 'release')),
  title        text,
  source_url   text,
  notes        text
);
create index balance_change_effective on balance_change (effective_at);

create table balance_change_card (
  patch_id   text not null references balance_change on delete cascade,
  card_id    integer not null references card,
  form       smallint not null default 0 check (form between 0 and 3),
  change     text not null check (change in ('buff', 'nerf', 'rework', 'release', 'evolution', 'hero')),
  summary    text,
  primary key (patch_id, card_id, form)
);

-- What the API can tell us on its own: a catalog delta. The cards projector
-- already knows when a card row changed ("newer-and-distinct", cards.mjs:52-72);
-- it appends here instead of losing the prior value.
create table card_catalog_change (
  card_id      integer not null references card,
  observed_at  timestamptz not null,
  field        text not null check (field in ('new_card', 'elixir_cost', 'max_level', 'max_evolution_level', 'rarity', 'name')),
  before       text,
  after        text,
  primary key (card_id, observed_at, field)
);
```

The `season` row is the calendar the code already computes, made
queryable and joinable. `balance_change` has no API source and must be fed
by hand (Supercell's monthly notes land on the season roll, with occasional
mid-season hotfixes); `card_catalog_change` is the automatic proxy the API
does give us (new card ids, elixir-cost and level-cap moves, new evolution
bits), and the cards projector already detects each of these and throws
the old value away.

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
at rollup time from the same function. The exception is
`battle.season_id`, which already exists for war attribution; see 1.2.

**The tools: default window and the boundary rule.** Today
`battles_meta_cards`, `battles_meta_decks` and `cards_synergy` default to
`now() - 28 days` (`resolveWindow(ctx, args, {defaultDays: 28})`,
`battles.mjs:1089,1249`, `synergy.mjs:104`) and `applied.window` echoes
`{from, to, source: "default"}` with no season in it. Proposed contract
(minor bump, additive):

1. **Default = current season to date**, from `season.starts_at`.
   `applied.window` gains `season: {season_id, season_month, starts_at,
   ends_at}` and `source: "season"`. `rankings_timeline` and `game_events`
   already default this way (`rankings.mjs:628,787`); the meta tools join
   them.
2. **A `season` argument** on the three meta tools and `battles_trends`:
   `"current"` (default), `"previous"`, an integer id, or `YYYY-MM`. It
   sets `from`/`to` from the row; `from`/`to`/`days`/`weeks` still win when
   given, as today.
3. **When the resolved window crosses a boundary**, whatever set it, the
   response says so in a structured field and a note. `applied.window`
   gains `crosses: [{kind: "season", at, from_season_id, to_season_id},
   {kind: "balance_change", at, patch_id, cards: n}]` (empty array when
   clean), and `notes` gains one sentence: *"Window spans S135 and S136;
   the 2026-09-07 balance change moved 11 cards, so card values before and
   after are not one population. Pass season:'current' or split with
   from/to."* Nothing is refused: an agent asking across a boundary may
   mean it. The `crosses` field is what lets a consumer refuse for itself.
4. **When the current season is thin**, say it rather than widen it. On
   day 1 of a season the default window holds one day. The existing
   `insufficient_sample` mechanism (`segment_min_decided: 30`) already
   fires; add `season_age_days` to `applied.window` and a note that
   `season:'previous'` is the settled comparison. Never silently fall back
   to 28 days, which is how the boundary got crossed in the first place.
5. **`battles_trends`** groups by ISO week and already crosses seasons by
   design; it gets `crosses` (so a consumer can draw the line) and, per
   week row, `season_id`.

The default-window decision in numbers: on 2026-09-17 the 28-day window is
14% S135 rows. On 2026-10-05 (S137 roll) it would be 100% S136 for one day
and then decay. A rolling window is never season-clean; a season window is
clean by construction and exactly what the game itself reports (Path of
Legends boards, league stats, war logs are all per season).

**Cost.** `season` is under 20 rows; `balance_change*` grows by tens of
rows a month; `card_catalog_change` by the handful of changes the catalog
sees. Contract: minor (additive argument and fields). Ingest: the cards
projector gains an insert on change; the scheduler gains a once-per-season
upsert. Risk: low; the only behaviour change is the default window, which
is the point.

### 1.2 War keys on battles: validate them against the season, and repair the import

**Finding.** `battle.season_id`, `section_index`, `war_day` are stamped by
`stampWarKeys` only for `riverRace%`/`boatBattle` types, only for battles
within 14 days, only when the *clan's* `currentriverrace` poll follows the
battle, and only once (`war.mjs:511-546`). Result: 208,452 battles have no
season (fine for non-war types), but of the 13,113 war-type battles,
10,000 (76%) are unstamped (`riverRacePvP` 7,227 of 9,927 unstamped,
`riverRaceDuel` 1,293 of 2,160, `boatBattle` 1,773 of 1,972). `war_current`
attendance (`war.mjs:327-348`), `war_history` member weeks and
`clans_participation` all join `battle` on `(season_id, section_index,
war_day)`, so three quarters of the war battles the record holds are
invisible to the war readers.

**Fix.**

```sql
-- 01xx_battle_war_keys_fk.sql  (instant: NOT VALID takes no scan lock)
alter table battle
  add constraint battle_season_fk foreign key (season_id) references season not valid;
-- later, its own migration once the repair op has run:
alter table battle validate constraint battle_season_fk;
```

plus a **migrate op**, not a migration (it touches 9.5k rows, small, but
the shape should be the batched one on principle):

```sql
-- {rekey_war_battles}: null every stamp that disagrees with the season the
-- battle_time falls in, then re-stamp from the calendar for any war battle
-- whose (clan, season, section) week row exists.
update battle b set season_id = null, section_index = null, war_day = null
from season s
where b.season_id is not null
  and s.season_id = b.season_id
  and (b.battle_time < s.starts_at or b.battle_time >= s.ends_at);
```

and the stamper itself should resolve from `battle_time` against `season`
plus the clan's `war_period_anchor`, for *all* unstamped war battles of a
recorded clan, not the last 14 days. The war readers gain the 10,000
battles they cannot see. Add `check (war_day between 1 and 4)` and `check
(section_index between 0 and 4)` while the column is small.

**Cost.** One-off op over 9.5k rows; no index change. Risk: the re-stamp
must respect the 09:34-10:00Z stand-by window (0048) by taking the
boundary from `season.starts_at`, which is 10:00Z, never from a poll time.

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
| `war_week.season_id -> season`, `war_participation.season_id -> season`, `ranking_presence`/`ranking_snapshot` after 1.6 | 0 | small |

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
`integer references season` (1,266 rows, instant rewrite is acceptable at
this size but do it as add-column + fill + swap to keep the rule).

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

**Grain.** `(season_id, mode_group, card_id, form)` with
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

**Refresh shape.** A migrate op `{meta_rollup:{season_id}}` for the
nightly recompute and backfill; the hourly increment in `services/jobs`
next to `activity_histogram`. Ingest is untouched: no write amplification
on the battle transaction (an increment per played card would be 16
upserts per battle).

```sql
create table card_meta_season (
  season_id   integer not null references season,
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
  primary key (season_id, mode_group, card_id, form)
);
```

### 2.2 `deck_meta_season`: per season, per mode group, per deck

**Grain.** `(season_id, mode_group, deck_hash)` with `battles, wins,
losses, players, first_used, last_used`. Clone: 121,813 distinct
`(season, type, deck_hash)` since 08-03 at raw-type grain, so ~80-100k
rows per season at mode-group grain, ~12 MB heap + ~8 MB index per season.
Same refresh split as 2.1 (counters hourly, `players` nightly). `deck`
itself stays identity-only (`first_seen_at`/`last_seen_at` already there).

**What it fixes.** Corpus deck meta 4.7 s -> a filtered index read
(`where season_id = $1 and mode_group = $2 order by battles desc limit
$3`, needs `(season_id, mode_group, battles desc)`), and the 6 timeouts.
`battles_query` `deck_stats` (an unbounded `count(distinct player_tag)` per
deck, `battles.mjs:427-437`) reads its per-season rows instead.

### 2.3 `card_pair_season`: synergy without the anchor subquery

**Grain.** `(season_id, mode_group, card_a, form_a, card_b, form_b)` for
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
and add `season_id` to nothing: a day maps to a season through `season`.

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

### 3.1 JSON that six readers parse: `player_snapshot_daily.lifetime` and `pol`

`lifetime->>'battleCount'`, `->>'collectionLevel'`, `->>'wins'` and
`pol->'current'->>'leagueNumber'` are extracted in `battles_compare`,
`players_timeline` (inside `distinct on`), `players_collection`,
`entries.mjs` and `coverage.mjs` (inside a `lag() over`). Add four integer
columns (`battle_count`, `collection_level`, `wins`, `pol_league_number`),
nullable, filled by the projector from now on and by a small batched op for
the 14,665 rows. Keep `lifetime`/`pol`/`league_stats` as the verbatim
profile fragments `players_profile` returns whole. Note `league_stats` is a
JSON `null` (scalar) on 6,150 rows and an object on 8,515: `jsonb_typeof`
guards are required wherever it is walked.

### 3.2 JSON that is fine where it is

`battle_participant.tower_hp` (`{king, princess[]}`, returned whole by
`battles_query` only); `card.icon_urls` (passthrough);
`player_event.payload`/`clan_event.payload` (evidence objects read by the
timeline in JS, shape varies per kind, correctly JSON);
`player_activity.rhythm`/`days` (a computed cache with one reader).
`api_receipt.admission_errors` (diagnostics).

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

---

## Sequenced plan

Each line is one migration unless it says op. "Instant" means the ALTER
holds its lock for milliseconds; nothing here rewrites a large table.

| #   | Change                                                                                                      | Kind                                         | Contract |
| --- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------- | -------- |
| 1   | `season` table + seed S129..S137; scheduler upserts on rollover                                              | instant (create table)                       | none     |
| 2   | `balance_change`, `balance_change_card`, `card_catalog_change`; cards projector appends changes             | instant                                      | none     |
| 3   | Meta tools: default window = current season; `season` argument; `applied.window.season` and `crosses`; the boundary note | code                              | **minor** (3.10) |
| 4   | `battle.season_id` FK `not valid`; `check` on `war_day`/`section_index`                                      | instant                                      | none     |
| 5   | op `{rekey_war_battles}`: null the 3,230 contradicting stamps; stamper re-stamps all unstamped war battles from `season` + anchor | op, 9.5k rows            | none     |
| 6   | `validate constraint` on 4                                                                                   | scan, SHARE UPDATE EXCLUSIVE                 | none     |
| 7   | Closing FKs `not valid`: participant->deck, player_card->card, three war tables->war_week                    | instant                                      | none     |
| 8   | `validate` the five; NOT NULL on `battle_participant.battle_time`/`type` via check-then-set; drop the `type_class` default; delete the empty deck + `card_count > 0` | scans, no rewrite | none |
| 9   | CHECKs on `player_event.event_type`, `clan_event.event_type`, `rollup.mode_group`; `poll_state.period_type` split; `ranking_snapshot.season_id` -> integer FK (add, fill 1,266 rows, swap) | instant + tiny fill | none |
| 10  | `snapshot_kind`: `season_roll` -> `pre_reset` (996 rows); widen check; real season-roll snapshot in the hour before `season.ends_at` | instant + 996-row update | none (internal) |
| 11  | Drop `battle.modifiers`, `war_attendance_day.finalized`, the three rollup completeness columns; `clans_participation` stops returning `finalized` | instant | **minor** (field removed from a response: treat as minor with a changelog line, since it was never true) |
| 12  | `card_meta_season`, `deck_meta_season`, `card_pair_season` + op `{meta_rollup}` (nightly + backfill per season) + hourly counters in jobs | instant create; backfill op is per-season scans (~11 s each on the micro, 4 seasons) | none |
| 13  | Meta tools read 12; `corpusPrior` reads its totals; `set local work_mem` in the meantime                     | code                                         | none (same fields, faster; `players_as_of` added: minor) |
| 14  | Wire `player_daily_battle_rollup` into `clans_standings`, `battles_trends`, `players_summary`, `first-answer`  | code                                         | none     |
| 15  | Snapshot columns (`battle_count`, `collection_level`, `wins`, `pol_league_number`) + batched fill of 14.7k rows | instant + op                              | none     |
| 16  | Index diet on `battle_participant` after a week of `idx_scan` evidence; `clan_membership` partial index       | `drop index concurrently` / `create index concurrently` | none |
| 17  | `arena` seed + FK; `api_receipt.job_id` FK `on delete set null`; `poll_state.subject_tag` -> `subject_key`; comments on the two declined FKs | instant | none |

Items 1-3 are the season model and can ship together as one contract bump.
Items 4-6 must be in that order across two deploys (the FK cannot validate
until the op has run). Item 12 is the only one that needs an op with real
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
| `battle.season_id -> (no table)`                              | 3,230 contradict `battle_time` | 1.1, 1.2       |

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
