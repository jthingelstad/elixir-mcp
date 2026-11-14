-- 0269: Passports and Stamps, four new tables (2026-11-14, #1015).
--
-- Every person account gets a passport of dated Stamps that any signed-in
-- member can open (docs/product/stamps.md, the build handoff
-- docs/plans/stamps-build.md). This is the storage for the first slice:
-- the catalog, eligibility and store live in packages/stamps. Nothing
-- here grants a Stamp; the later slices' hooks and reconciliation call
-- the store.
--
-- account_passport: the account's public passport id, random and opaque.
-- account.public_id stays the agents' (0053); an internal account UUID
-- or anything from an email never goes in a URL. Person accounts only:
-- the store inserts from account where kind = 'person'.
--
-- account_stamp_earned: one row per earned level, unique (account,
-- Stamp, level), so a retry or a race can only ever insert a level once.
-- earned_at is the UTC instant; earned_on is the local day in the
-- account's zone when it was granted, frozen there, so a later zone
-- change never moves it. definition_version is the catalog version it
-- was granted under. A legacy grant (a later backfill with no
-- trustworthy instant) has earned_on null, legacy_before the day it is
-- known to precede ("Earned before <day>") and the source window it was
-- read from; earned_at is then when it was granted.
--
-- account_stamp_fact: the lifetime evidence for the three ladders
-- (Played Together days, Cheerleader days, Storyteller battles), so
-- progress outlives the record's one-year retention. One row per
-- distinct qualifying day or battle, capped by the store at the top
-- threshold (20, 50, 20: 90 rows a person at most). A source event is
-- accepted once (unique source_hash); its day is computed from the
-- account's zone at first acceptance and stored with that day's UTC
-- bounds, so a replay after a zone change lands in the same day. The
-- qualifier and the source are sha256 digests or a date: no city,
-- coordinates, Discord name, highlight words or anyone else's data.
--
-- account_profile_list: the six-step profile list (version 2). Step
-- latches, the explicit digest and map choices, the first successful
-- place save and the completed marker. Home's older four-step welcome
-- keeps its own account.welcome_finished_at (0246), never cleared here.
--
-- All four cascade on account deletion; the account-removal op deletes
-- them too, since removal keeps a tombstone row. New tables only: the
-- foreign keys take a brief lock on account, so fail fast rather than
-- queue sign-ins behind a long read, and let the deploy be retried.

set local lock_timeout = '5s';

create table account_passport (
  account_id   uuid primary key references account on delete cascade,
  passport_id  text not null unique
               check (passport_id ~ '^[a-km-np-z2-9]{12}$'),
  created_at   timestamptz not null default now()
);

comment on table account_passport is
  '0269: a person account''s passport. passport_id is random and opaque, the only id a passport URL carries; never the account UUID or account.public_id.';

create table account_stamp_earned (
  account_id          uuid not null references account on delete cascade,
  stamp_id            text not null check (stamp_id ~ '^[a-z][a-z_]{2,31}$'),
  level               smallint not null check (level between 1 and 3),
  earned_at           timestamptz not null,
  earned_on           date,
  definition_version  integer not null check (definition_version >= 1),
  legacy_before       date,
  legacy_source_from  timestamptz,
  legacy_source_to    timestamptz,
  primary key (account_id, stamp_id, level),
  check (
    (legacy_before is null and earned_on is not null
      and legacy_source_from is null and legacy_source_to is null)
    or (legacy_before is not null and earned_on is null
      and legacy_source_to is not null
      and (legacy_source_from is null or legacy_source_from <= legacy_source_to))
  )
);

comment on table account_stamp_earned is
  '0269: earned Stamp levels, one row each, never revoked. Ids come from packages/stamps catalog.';
comment on column account_stamp_earned.earned_on is
  '0269: the local day in the account''s zone when granted, frozen. Null only for a legacy grant.';
comment on column account_stamp_earned.legacy_before is
  '0269: a legacy grant with no trustworthy instant: shown as earned before this day. Null for an ordinary grant.';

create table account_stamp_fact (
  account_id     uuid not null references account on delete cascade,
  stamp_id       text not null check (stamp_id ~ '^[a-z][a-z_]{2,31}$'),
  qualifier      text not null
                 check (qualifier ~ '^(day:[0-9]{4}-[0-9]{2}-[0-9]{2}|battle:[0-9a-f]{64})$'),
  source_hash    text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  event_at       timestamptz not null,
  local_day      date,
  day_starts_at  timestamptz,
  day_ends_at    timestamptz,
  accepted_at    timestamptz not null default now(),
  primary key (account_id, stamp_id, qualifier),
  unique (account_id, stamp_id, source_hash),
  check ((local_day is null) = (day_starts_at is null)
         and (local_day is null) = (day_ends_at is null)),
  check (day_starts_at is null or day_starts_at < day_ends_at)
);

comment on table account_stamp_fact is
  '0269: one distinct qualifying day or battle toward a Stamp ladder, capped at its top threshold. Digests and dates only.';
comment on column account_stamp_fact.qualifier is
  '0269: day:<local date> for a day ladder, battle:<sha256 of the battle id> for Storyteller.';
comment on column account_stamp_fact.source_hash is
  '0269: sha256 of the Stamp and the source event''s identity, so one event is accepted once.';
comment on column account_stamp_fact.day_starts_at is
  '0269: the UTC start of local_day in the zone used at first acceptance; an event inside [day_starts_at, day_ends_at) belongs to this day whatever the zone is later.';

create table account_profile_list (
  account_id          uuid primary key references account on delete cascade,
  list_version        smallint not null default 2 check (list_version >= 2),
  add_player_at       timestamptz,
  verify_player_at    timestamptz,
  picture_at          timestamptz,
  follow_active_at    timestamptz,
  digest_choice       text check (digest_choice in ('weekly', 'daily', 'off')),
  digest_at           timestamptz,
  map_choice          text check (map_choice in ('place', 'not_now')),
  map_at              timestamptz,
  map_place_saved_at  timestamptz,
  completed_at        timestamptz,
  updated_at          timestamptz not null default now(),
  check (digest_choice is null or digest_at is not null),
  check (map_choice is null or map_at is not null)
);

comment on table account_profile_list is
  '0269: the six-step profile list (version 2). *_at columns latch a step done; completed_at is set once and never cleared. account.welcome_finished_at (0246) is the older list''s and is left alone.';
comment on column account_profile_list.map_choice is
  '0269: the person''s explicit map choice. not_now completes the step and never earns On the Map.';
comment on column account_profile_list.map_place_saved_at is
  '0269: the first successful place save, the only evidence for On the Map. No location is stored here.';
comment on column account_profile_list.digest_choice is
  '0269: the person''s explicit digest choice; off counts. The default weekly digest is not a choice.';
