-- 0001: recorder core — identity/tenancy (DESIGN §4.1-4.2), provenance
-- (§4.3), canonical battles (§4.4), snapshots/events/rollups (§4.5),
-- gateways (§4.6), scheduler state (§5.1).
-- Auth-plane tables (magic links, sessions, OAuth, quotas) land in 0002
-- alongside the auth port. All timestamps UTC (timestamptz).

-- ---------------------------------------------------------------- identity

create table account (
  account_id  uuid primary key default gen_random_uuid(),
  email_hash  text not null unique,          -- sha256(lowercased email)
  status      text not null default 'requested'
              check (status in ('requested', 'approved', 'denied', 'disabled')),
  is_owner    boolean not null default false,
  request_note text,                          -- free text from the access form
  requested_player_tag text,                  -- what they claimed to be, for review
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);

-- Game entities key on CR tags only; accounts never appear in game tables.
create table player (
  player_tag    text primary key check (player_tag ~ '^#[0289PYLQGRJCUV]{3,12}$'),
  name          text,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

create table clan (
  clan_tag      text primary key check (clan_tag ~ '^#[0289PYLQGRJCUV]{3,12}$'),
  name          text,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

create table claim (
  account_id  uuid not null references account,
  player_tag  text not null references player,
  status      text not null default 'unverified'
              check (status in ('unverified', 'verified')),
  verified_method text,
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now(),
  primary key (account_id, player_tag)
);
-- At most one VERIFIED claim per tag (unverified may coexist, §4.1).
create unique index claim_one_verified_per_tag
  on claim (player_tag) where status = 'verified';
-- Exactly one primary claim per account (tool player_tag defaulting, §3).
create unique index claim_one_primary_per_account
  on claim (account_id) where is_primary;

-- Observed tenure, never asserted (elixir-bot invariant, §4.1).
create table clan_membership (
  clan_tag           text not null references clan,
  player_tag         text not null references player,
  joined_observed_at timestamptz not null,
  left_observed_at   timestamptz,             -- NULL = membership open
  role               text,
  primary key (clan_tag, player_tag, joined_observed_at)
);
create unique index clan_membership_one_open_per_player
  on clan_membership (player_tag) where left_observed_at is null;

create table recording (
  recording_id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('player', 'clan')),
  subject_tag  text not null,
  requested_by uuid not null references account,
  status       text not null default 'active'
               check (status in ('active', 'paused', 'stopped')),
  created_at   timestamptz not null default now()
);
create unique index recording_one_active_per_subject
  on recording (subject_type, subject_tag) where status = 'active';

-- ---------------------------------------------------------------- gateways

create table gateway (
  gateway_id        uuid primary key default gen_random_uuid(),
  owner_account_id  uuid not null references account,
  name              text not null,
  static_ip         inet not null,
  key_source        text not null default 'jamie'
                    check (key_source in ('jamie', 'operator')),
  cr_key_ref        text,                     -- reference only; never the key
  status            text not null default 'pending'
                    check (status in ('pending', 'probation', 'active', 'draining', 'revoked')),
  enrolled_at       timestamptz not null default now(),
  last_heartbeat_at timestamptz,
  last_success_at   timestamptz
);

-- -------------------------------------------------------------- provenance

-- Content-addressed payload store: identical bodies stored once (§4.3).
-- A rolling analysis buffer (~60d retention), never the system of record.
create table api_payload (
  payload_id       bigint generated always as identity primary key,
  endpoint         text not null,
  entity_key       text not null,
  payload_hash     text not null,             -- sha256 of canonical JSON
  payload_json     jsonb not null,
  first_fetched_at timestamptz not null default now(),
  last_fetched_at  timestamptz not null default now(),
  unique (endpoint, entity_key, payload_hash)
);

-- Append-only: one row per HTTP 200, regardless of dedup (§4.3).
create table api_receipt (
  receipt_id   bigint generated always as identity primary key,
  endpoint     text not null,
  entity_key   text not null,
  fetched_at   timestamptz not null default now(),
  payload_hash text not null,
  gateway_id   uuid not null references gateway,
  admission    text not null check (admission in ('admitted', 'rejected')),
  admission_errors jsonb
);
create index api_receipt_entity on api_receipt (endpoint, entity_key, receipt_id desc);
create index api_receipt_fetched on api_receipt (fetched_at desc);

-- ---------------------------------------------------------------- battles

-- battle_id = sha256(canonical battle_time ":" sorted participant tags ":"
-- type_class) — derived from the CANONICAL STORED battle_time so key and
-- column can never disagree (the v25 duplicate incident, §4.4).
create table battle (
  battle_id     text primary key,
  cursor        bigint generated always as identity unique, -- tailing (§13)
  battle_time   timestamptz not null,
  type          text not null,
  type_class    text not null check (type_class in ('pvp', 'boat')),
  game_mode_id  integer,
  game_mode_name text,
  arena         text,
  league_number integer,
  -- War keys resolved from the battle's OWN time, never poll time (§4.4).
  season_id     integer,
  section_index integer,
  war_day       integer,
  modifiers     jsonb,
  created_at    timestamptz not null default now()
);
create index battle_time_idx on battle (battle_time desc);

-- One row per participant, written symmetrically for claimed and unclaimed
-- tags alike (§4.1). Traps encoded at ingest, not in readers: tournament
-- startingTrophies is score not ladder; trophyChange only on PvP/PoL;
-- tower HP is margin-of-victory, never progression (§4.4).
create table battle_participant (
  battle_id         text not null references battle,
  player_tag        text not null references player,
  side              smallint not null,        -- 0/1: which team
  crowns            smallint,
  trophy_change     integer,
  starting_trophies integer,
  deck              jsonb,
  deck_hash         text,                     -- contracts deckHash, one definition
  support_cards     jsonb,
  elixir_leaked     numeric,
  tower_hp          jsonb,
  outcome           text check (outcome in ('win', 'loss', 'draw', 'unresolved')),
  clan_tag          text,                     -- clan AT BATTLE TIME, not today
  primary key (battle_id, player_tag)
);
create index battle_participant_player
  on battle_participant (player_tag, battle_id);
create index battle_participant_deck
  on battle_participant (player_tag, deck_hash);

-- Which observer's battlelog we saw the battle in (§4.4).
create table battle_observation (
  battle_id    text not null references battle,
  observer_tag text not null references player,
  receipt_id   bigint not null references api_receipt,
  primary key (battle_id, observer_tag)
);

-- --------------------------------------------- snapshots, events, rollups

create table player_snapshot_daily (
  player_tag      text not null references player,
  snapshot_date   date not null,              -- UTC day
  snapshot_kind   text not null default 'daily'
                  check (snapshot_kind in ('daily', 'season_roll')),
  trophies        integer,
  pol             jsonb,                      -- current/best Path of Legends
  league_stats    jsonb,
  donations       integer,
  donations_received integer,
  lifetime        jsonb,                      -- battleCount, wins, etc.
  collection_hash text,                       -- full collection stored on change
  created_at      timestamptz not null default now(),
  primary key (player_tag, snapshot_date, snapshot_kind)
);

-- Typed diff streams with honest time semantics (§4.5): polling is
-- discrete, so most events are observed-between-polls, not exact.
create table player_event (
  event_id     bigint generated always as identity primary key, -- cursor (§13)
  player_tag   text not null references player,
  event_type   text not null,
  timing       text not null check (timing in ('exact', 'estimated')),
  occurred_at  timestamptz,                   -- exact events only
  window_start timestamptz not null,
  window_end   timestamptz not null,
  payload      jsonb not null,                -- evidence, not conclusions (§13)
  receipt_id   bigint references api_receipt
);
create index player_event_player on player_event (player_tag, event_id desc);

create table clan_event (
  event_id     bigint generated always as identity primary key,
  clan_tag     text not null references clan,
  event_type   text not null,
  timing       text not null check (timing in ('exact', 'estimated')),
  occurred_at  timestamptz,
  window_start timestamptz not null,
  window_end   timestamptz not null,
  payload      jsonb not null,
  receipt_id   bigint references api_receipt
);
create index clan_event_clan on clan_event (clan_tag, event_id desc);

-- Rollups carry their own completeness rather than pretending (§5.4).
create table player_daily_battle_rollup (
  player_tag        text not null references player,
  day               date not null,            -- UTC day
  mode_group        text not null,
  game_mode_id      integer not null default 0,
  wins              integer not null default 0,
  losses            integer not null default 0,
  draws             integer not null default 0,
  crowns_for        integer not null default 0,
  crowns_against    integer not null default 0,
  trophy_delta      integer not null default 0,
  battles_captured  integer not null default 0,
  expected_battle_delta integer,
  completeness_ratio numeric,
  is_complete       boolean,
  primary key (player_tag, day, mode_group, game_mode_id)
);

create table clan_daily_metrics (
  clan_tag     text not null references clan,
  day          date not null,
  member_count integer,
  donations_total integer,                    -- MAX-merged: monotonic counter
  metrics      jsonb,
  primary key (clan_tag, day)
);

-- ---------------------------------------------------------- scheduler state

create table poll_state (
  subject_tag      text not null,
  endpoint         text not null,
  heat             integer not null default 2,  -- seed warm (§5.3)
  last_planned_at  timestamptz,
  last_admitted_at timestamptz,               -- advances on admission only
  primary key (subject_tag, endpoint)
);

-- Singleton token bucket settled by the scheduler tick (§5.1).
create table budget_state (
  singleton     boolean primary key default true check (singleton),
  tokens        numeric not null default 0,
  rate_per_sec  numeric not null default 1.0,
  burst         numeric not null default 5,
  live_reserve  numeric not null default 0.10,
  settled_at    timestamptz not null default now()
);
insert into budget_state default values;
