-- 0121: the season meta rollups (schema review Tier 2, 2.1-2.3; plan
-- step 12). Additive, instant: five tables, nothing filled here. The
-- nightly job (services/jobs/src/meta-rollup.mjs) rebuilds the running
-- season and fills any ended season that has rows but no final rollup;
-- the hourly job increments the counters from battles created since the
-- season's cursor. Nothing in ingest changes: an increment per played
-- card on the battle transaction would be sixteen upserts a battle.
--
-- Grain: the API's month (season_month), the contract's six mode groups
-- plus 'all' (a distinct-player count does not sum across modes, so the
-- default "every mode" read has its own rows), then the deck, the card
-- by form, or the card pair. `players` is recomputed nightly and NEVER
-- incremented: for Knight in S136 pvp the window-distinct count was
-- 12,330 while the sum of daily distincts was 14,650 (+19%). Card rows
-- with form -1 hold the card in ANY form (battles summed over forms,
-- players distinct across them), which is what a merged-form anchor in
-- cards_synergy needs; pair rows carry -1 on at most one side.
--
-- What the population is, exactly as the meta tools count it (shared.mjs
-- excludedBreakdown / corpusPrior): considered = every participant in
-- the season and mode; decided = pvp head-to-head with a deck and a
-- win/loss outcome; the rest is what `excluded` reports.
create table meta_season_state (
  season_month      text primary key references season,
  counters_through  timestamptz not null,
  rebuilt_at        timestamptz,
  final             boolean not null default false
);
comment on table meta_season_state is
  'One row per season the rollups cover: counters_through is the battle.created_at cursor of the hourly increment, rebuilt_at the last nightly full rebuild (the distinct-player counts are as of it), final marks an ended season the job will not touch again.';

create table meta_season_totals (
  season_month  text not null references season,
  mode_group    text not null check (mode_group in ('all', 'ladder', 'ranked', 'casual', 'war', 'challenge', 'tournament')),
  considered    integer not null default 0,
  duels         integer not null default 0,
  boat          integer not null default 0,
  draws         integer not null default 0,
  unresolved    integer not null default 0,
  no_deck       integer not null default 0,
  decided       integer not null default 0,
  wins          integer not null default 0,
  primary key (season_month, mode_group)
);

create table deck_meta_season (
  season_month  text not null references season,
  mode_group    text not null check (mode_group in ('all', 'ladder', 'ranked', 'casual', 'war', 'challenge', 'tournament')),
  deck_hash     text not null references deck (deck_hash),
  battles       integer not null default 0,
  wins          integer not null default 0,
  losses        integer not null default 0,
  players       integer,
  first_used    timestamptz not null,
  last_used     timestamptz not null,
  primary key (season_month, mode_group, deck_hash)
);
create index deck_meta_season_battles
  on deck_meta_season (season_month, mode_group, battles desc);

create table card_meta_season (
  season_month  text not null references season,
  mode_group    text not null check (mode_group in ('all', 'ladder', 'ranked', 'casual', 'war', 'challenge', 'tournament')),
  card_id       integer not null references card (card_id),
  form          smallint not null check (form between -1 and 3),
  battles       integer not null default 0,
  wins          integer not null default 0,
  losses        integer not null default 0,
  players       integer,
  primary key (season_month, mode_group, card_id, form)
);

create table card_pair_season (
  season_month  text not null references season,
  mode_group    text not null check (mode_group in ('all', 'ladder', 'ranked', 'casual', 'war', 'challenge', 'tournament')),
  card_a        integer not null references card (card_id),
  form_a        smallint not null check (form_a between -1 and 3),
  card_b        integer not null references card (card_id),
  form_b        smallint not null check (form_b between -1 and 3),
  co_battles    integer not null default 0,
  wins          integer not null default 0,
  players       integer,
  primary key (season_month, mode_group, card_a, form_a, card_b, form_b),
  check (card_a < card_b),
  check (not (form_a = -1 and form_b = -1))
);
create index card_pair_season_b
  on card_pair_season (season_month, mode_group, card_b, form_b);
