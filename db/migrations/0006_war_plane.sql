-- 0006: the war plane (DESIGN §4.5, V2) + battle-sharing consent (§4.2).
--
-- NAMING DISCIPLINE (§13, imported scar tissue): members contribute
-- POINTS; fame belongs to the boat. The CR payload calls the per-member
-- value "fame" — we store it as points, and per-member division of clan
-- fame is banned by construction. Clan-level fame (war_week_clan.fame)
-- is legitimately the boat's own number.
--
-- Counters merge with MAX at the projector (monotonic-accumulator
-- discipline); nothing here relies on last-write.

-- Observed period anchors: when the recorder FIRST saw a period open.
-- The war clock prefers these over the nominal ~10:00Z reset grid.
create table war_period_anchor (
  clan_tag          text not null references clan,
  period_index      integer not null,
  first_observed_at timestamptz not null,
  primary key (clan_tag, period_index)
);

create table war_week (
  clan_tag       text not null references clan,
  season_id      integer not null,
  section_index  integer not null,
  is_colosseum   boolean not null default false,
  started_observed_at timestamptz,
  finished_observed_at timestamptz,
  primary key (clan_tag, season_id, section_index)
);

-- Standings across the 5 clans in the race, one row per participant clan.
create table war_week_clan (
  clan_tag             text not null references clan,   -- whose race view
  season_id            integer not null,
  section_index        integer not null,
  participant_clan_tag text not null,
  participant_name     text,
  fame                 integer not null default 0,      -- the boat's number
  finish_time          timestamptz,
  primary key (clan_tag, season_id, section_index, participant_clan_tag)
);

create table war_participation (
  clan_tag      text not null references clan,
  season_id     integer not null,
  section_index integer not null,
  player_tag    text not null references player,
  points        integer not null default 0,             -- NOT fame (§13)
  decks_used    integer not null default 0,
  boat_attacks  integer not null default 0,
  primary key (clan_tag, season_id, section_index, player_tag)
);
create index war_participation_by_player on war_participation (player_tag);

create table war_attendance_day (
  clan_tag        text not null references clan,
  season_id       integer not null,
  section_index   integer not null,
  war_day         integer not null,                     -- 1..4
  player_tag      text not null references player,
  decks_used_today integer not null default 0,
  finalized       boolean not null default false,
  primary key (clan_tag, season_id, section_index, war_day, player_tag)
);

-- Battle-level sharing consent (§4.2 rule 2): war battles are readable
-- clan-scoped by default; NON-war battle-level history of a clanmate
-- requires that member's own opt-in.
alter table claim add column share_battles_with_clan boolean not null default false;
