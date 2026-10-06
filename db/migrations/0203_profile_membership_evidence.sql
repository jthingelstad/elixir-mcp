-- 0203: dated profile evidence of clan membership, including explicit absence.
-- The beta journey review (2026-10-06) found that missing observations were
-- presented as no clan. Retained last-known tags and null roster roles cannot
-- prove absence. A new private projection starts empty and fills prospectively
-- from admitted profiles. No history rewrite or backfill. A separate table
-- preserves the identity row's existing change-only write discipline.
-- Empty table and primary key; fail fast behind a concurrent parent-table lock.
set local lock_timeout = '5s';
create table player_profile_membership (
  player_tag text primary key references player(player_tag),
  state text not null check (state in ('member', 'none', 'unknown')),
  observed_at timestamptz not null
);
comment on table player_profile_membership is
  '0203: latest admitted projected profile membership evidence, not a role or permission. No row before observation; same-time conflicts remain unknown. Retained last-known tags are unchanged.';
comment on column player_profile_membership.state is
  'member: valid profile clan; none: explicit absent clan; unknown: malformed optional clan or conflicting observations. This is an Elixir evidence enum, not an API enum.';
comment on column player_profile_membership.observed_at is
  'Source fetched_at, never cache touch time. Old replays cannot regress it. A newer admitted but unprojected profile invalidates this evidence at read time.';
