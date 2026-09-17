-- 0127: the roster writes the player's own snapshot row (time-series
-- review 4.2; Jamie 2026-09-17, decision 2: every member of every polled
-- clan), and the profile's dropped lifetime and state fields (1.3, 2.1,
-- 4.4). Nullable columns and one partial index on a 15k-row table:
-- instant, expand only. The snapshot's day is the game day since the
-- {snapshot_rekey} op that preceded this migration (0126, 3.2).
--
-- Two writers, one row. The roster projector writes trophies, donations,
-- donations_received, arena_id and the four roster columns below, guarded
-- on those columns and observed_at; the profile projector writes
-- everything else, guarded on its own columns and profile_observed_at,
-- and still advances observed_at. Neither can regress the other, and a
-- 15-minute roster write cannot make an 8-hour-old rating look fresh.
alter table player_snapshot_daily
  add column clan_tag            text references clan,
  add column clan_rank           smallint,
  add column previous_clan_rank  smallint,
  add column game_last_seen_at   timestamptz,
  add column profile_observed_at timestamptz,
  add column source              text not null default 'api'
                                 check (source in ('api', 'elixir-bot')),
  -- The profile's lifetime block (the class wins is in) and the tower.
  add column total_donations         integer,
  add column challenge_cards_won     integer,
  add column challenge_max_wins      integer,
  add column tournament_cards_won    integer,
  add column tournament_battle_count integer,
  add column king_tower_level        smallint;
comment on column player_snapshot_daily.clan_tag is
  'The clan whose roster wrote this row that day (the member''s clan as of the winning roster observation); null on a row only the profile wrote.';
comment on column player_snapshot_daily.game_last_seen_at is
  'The game''s own lastSeen for the member as of the day''s winning roster observation: the presence series. A poll that moved only this column writes when it is an hour or more past the stored value.';
comment on column player_snapshot_daily.profile_observed_at is
  'When the profile-only columns were last observed; null on a day the roster wrote and no profile poll did. observed_at is the newest observation of either writer.';
comment on column player_snapshot_daily.source is
  'api: written from an admitted payload (live or archive backfill). elixir-bot: imported from the bot''s own series through the projector (review Part 6).';
-- Every row so far was the profile's (the roster wrote nothing before
-- this migration), so its profile stamp is its stamp: 14.9k rows, in
-- this transaction, the 0123 shape for a small table.
update player_snapshot_daily set profile_observed_at = observed_at
 where profile_observed_at is null and observed_at is not null;
-- The clan timeline's per-day aggregate over the members and the member
-- series scoped by clan; partial so the profile-only rows cost nothing.
create index player_snapshot_daily_clan_day
  on player_snapshot_daily (clan_tag, snapshot_date) where clan_tag is not null;

-- Frozen counters and the retired road, state on the player, written
-- once when they differ (Clan Wars 1 ended in 2021: warDayWins and
-- clanCardsCollected read 0 on every probed profile and never move).
alter table player
  add column war_day_wins                  integer,
  add column clan_cards_collected          integer,
  add column legacy_trophy_road_high_score integer;

-- The clan's own state from the roster, change-only.
alter table clan
  add column type        text,
  add column location_id integer,
  add column description text;
