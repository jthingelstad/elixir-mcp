-- 0140: the meta rollup's population as a table, appended by game day
-- (interface review close-out, 2026-09-19: Run Elixir MCP).
--
-- The nightly rebuild re-derived `pop` - one row per participant in the
-- running season with its mode group, trophy band and level gap - from
-- the raw battle_participant heap every night and read it with all ten
-- aggregate statements. On day 12 of September that step alone was
-- 227 s of a 495 s run, and every statement scaled with the season's
-- rows: the run would have crossed the Lambda's 900 s around day 22 and
-- the final rebuild at the close would never have finished.
--
-- meta_season_pop holds that population for the running season, one
-- row per participant, keyed by the game day (0126) the battle falls
-- in. The nightly rebuilds only the game days not yet sealed - a day is
-- sealed once its 10:00Z end is a full day past the run's cursor, so a
-- battle log fetched hours late still lands in its day - and appends to
-- sealed days the battles recorded since the last run (battle.created_at
-- past the season's pop_through), so nothing late is lost. Every row is
-- bounded by created_at <= the run's cursor, which is also the hourly
-- increment's counters_through: the two writers never count a battle
-- twice. The full-rebuild and final paths build the same table the
-- same way, day by day, and the final path drops the season's rows once
-- its rollup is final (the rollup is what readers read; the raw rows
-- remain the source). meta_season_pop_day is the ledger of what is
-- built and sealed. Nothing here is read by a tool: no wire change.
--
-- Additive and instant (the 0099 rule): two empty tables and one
-- nullable column. Nothing is filled here; the nightly fills it.

create table meta_season_pop (
  season_month  text not null references season,
  game_day      date not null,
  battle_id     text not null,
  player_tag    text not null,
  deck_hash     text,
  outcome       text,
  battle_time   timestamptz not null,
  type          text not null,
  type_class    text not null,
  mode_group    text not null check (mode_group in ('ladder', 'ranked', 'casual', 'war', 'challenge', 'tournament')),
  trophy_band   text check (trophy_band in ('under_5000', '5000_8000', '8000_11000', '11000_13000', '13000_plus')),
  level_gap     numeric,
  primary key (season_month, game_day, battle_id, player_tag)
);
comment on table meta_season_pop is
  'The season meta rollup''s population (0140): one row per participant in the running season, the shape the nightly job aggregates, keyed by game day so the job rebuilds only the days not yet sealed. A cache of the raw rows, dropped when the season''s rollup is final; never read by a tool.';

create table meta_season_pop_day (
  season_month  text not null references season,
  game_day      date not null,
  rows          integer not null,
  built_at      timestamptz not null,
  sealed        boolean not null default false,
  primary key (season_month, game_day)
);
comment on table meta_season_pop_day is
  'Which game days of meta_season_pop are built, when, with how many rows, and whether sealed (its end a day past the cursor: rebuilt no more, appended to from late battles only).';

alter table meta_season_state add column pop_through timestamptz;
comment on column meta_season_state.pop_through is
  'The battle.created_at bound of the season''s meta_season_pop rows: every battle created at or before it is in the table; the next nightly appends the ones created after it.';
