-- A member's observed stay and the transition within it bind the leader's
-- decision, the roster observation, and the paragraphs published to the clan.
-- Empty at cutover. Earlier stories retain their original identities.
set local lock_timeout = '5s';
alter table timeline_comment add column audience_clan text;
alter table timeline_cheer add column audience_clan text;
create table clan_lifecycle (
  occasion_id bigint generated always as identity primary key,
  clan_tag text not null,
  player_tag text not null,
  stay_at timestamptz not null,
  kind text not null check (kind in ('welcome','promotion','demotion','departure')),
  prior_role_id bigint not null default 0,
  event_id bigint unique,
  observed_at timestamptz,
  roster_size integer,
  player_name text,
  action_id text,
  reported_at timestamptz,
  match_until timestamptz,
  published_at timestamptz,
  paragraphs text[],
  classification text,
  source text,
  evidence jsonb,
  processed_at timestamptz,
  retry_at timestamptz not null default now(),
  attempts integer not null default 0,
  unique (clan_tag, action_id)
);
create index clan_lifecycle_stay on clan_lifecycle
  (clan_tag,player_tag,stay_at,kind,prior_role_id);
create index clan_lifecycle_pending on clan_lifecycle (retry_at, occasion_id)
  where processed_at is null and event_id is not null;
create index clan_lifecycle_publication on clan_lifecycle (clan_tag,published_at);
