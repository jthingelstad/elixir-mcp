-- Everything else the API forgets about a season (Jamie, 2026-09-11: "do it all").
--
-- 0068 recorded the live Path of Legends boards. Probing the rest of the
-- API for what else a season is made of found four more things that are
-- shown as they are this minute and then dropped:
--
--   * A season's FINAL board. /locations/global/pathoflegend/{season}/rankings/players
--     serves the settled standing at full depth - 9,999 places - for every
--     season since S97, the ranked ladder's launch. Thirty-nine seasons of
--     history the API could stop serving any month; backfilled once, then
--     fetched for each season the day after it rolls.
--   * The clan ladders. /rankings/clans and /rankings/clanwars by location,
--     1,000 places each: the clan-side analogue of the player boards, for
--     the entity half this product is about.
--   * The game-mode boards. /leaderboards lists them (30 today, up from 15 in
--     March; they rotate with seasons) and /leaderboard/{id} serves each.
--   * What was ON. /events lists the modes and challenges running now, with
--     no dates; recording it daily gives the season's calendar as first and
--     last sightings, which is what explains a battle-log spike in a mode.
--     /globaltournaments is the same shape of thing, empty most days.
--
-- The player-board tables from 0068 carry the finals and the game-mode
-- boards as further kinds of board. The clan ladders get their own entry
-- table, because a placed clan is not a placed player.

-- Boards: the finals, the game-mode boards, and the two clan ladders.
alter table ranking_board drop constraint if exists ranking_board_board_check;
alter table ranking_board
  add constraint ranking_board_board_check
  check (board in ('pol', 'trophy', 'pol_final', 'mode', 'clans', 'clanwars'));
alter table ranking_board drop constraint if exists ranking_board_location_kind_check;
alter table ranking_board
  add constraint ranking_board_location_kind_check
  check (location_kind in ('global', 'region', 'country', 'season', 'mode'));

-- The finals: one board row; the season is the snapshot's season_id and the
-- job's entity key. Not on a cadence - the planner fetches a season's final
-- exactly once, when no snapshot for it exists yet.
insert into ranking_board (board, location_key, label, location_kind, every_minutes, record_top, enabled)
values ('pol_final', 'global', 'Path of Legends · season finals', 'season', 1440, 0, true);

-- The clan ladders, daily, global plus the two locations with collections.
insert into ranking_board (board, location_key, label, location_kind, country_code, every_minutes, record_top, enabled) values
  ('clans',    'global',   'Clan score · global',        'global',  null, 1440, 0, true),
  ('clans',    '57000249', 'Clan score · United States', 'country', 'US', 1440, 0, true),
  ('clans',    '57000122', 'Clan score · Japan',         'country', 'JP', 1440, 0, true),
  ('clanwars', 'global',   'Clan war trophies · global',        'global',  null, 1440, 0, true),
  ('clanwars', '57000249', 'Clan war trophies · United States', 'country', 'US', 1440, 0, true),
  ('clanwars', '57000122', 'Clan war trophies · Japan',         'country', 'JP', 1440, 0, true);

-- Game-mode boards arrive by enumeration: the leaderboards projector
-- upserts a ('mode', <id>) row per board the API lists and disables the
-- ones that vanish, so nothing here names an id that rotates.

-- A placed clan on a clan ladder.
create table clan_ranking_entry (
  snapshot_id    bigint not null references ranking_snapshot on delete cascade,
  rank           integer not null,
  previous_rank  integer,
  clan_tag       text not null,
  name           text,
  score          integer,               -- clanScore, or clan war trophies on the clanwars board
  members        integer,
  badge_id       integer,
  location_id    integer,
  primary key (snapshot_id, rank)
);
create index clan_ranking_entry_clan on clan_ranking_entry (clan_tag, snapshot_id);

comment on table clan_ranking_entry is
  'One placed clan on a recorded clan ladder (ranking_snapshot.board in clans, clanwars). score is clanScore on clans and clan war trophies on clanwars.';

-- What was on. An event is known by its tag; a day it was seen is a row.
create table game_event (
  event_tag      text primary key,
  title          text,
  description    text,
  first_seen_at  timestamptz not null,
  last_seen_at   timestamptz not null
);
create table game_event_day (
  event_tag      text not null references game_event,
  day            date not null,
  primary key (event_tag, day)
);

comment on table game_event is
  'An in-game event as /events listed it. The API gives no dates; game_event_day is the calendar, one row per UTC day the event was seen running.';

-- Global tournaments, kept whole: they are rare, small, and their shape is
-- the least settled thing in the API.
create table game_tournament (
  tournament_tag text primary key,
  payload        jsonb not null,
  first_seen_at  timestamptz not null,
  last_seen_at   timestamptz not null
);
