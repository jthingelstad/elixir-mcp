-- Keep the clan named by a profile with its own observation timestamp.
-- Nullable columns take brief ACCESS EXCLUSIVE locks. The existing
-- projection had 109 rows (64 KiB) at the production census. Fill only
-- from a unanimous retained payload at the exact admitted observation.
-- A missing body or a conflict awaits another profile or roster read.
-- vacuum after: player_profile_membership
set local lock_timeout = '5s';
set local statement_timeout = '15s';
alter table clan add column roster_observed_at timestamptz;
comment on column clan.roster_observed_at is
  '0305: time of the newest roster applied to current membership. A receipt alone supplies no membership evidence.';
alter table player_profile_membership
  add column clan_tag text,
  add column clan_observed_at timestamptz;
with observed as (
  select m.player_tag, m.observed_at, min(p.payload_json #>> '{clan,tag}') as clan_tag
    from player_profile_membership m
    join api_receipt r on r.endpoint='player' and r.entity_key=m.player_tag
                       and r.fetched_at=m.observed_at and r.admission='admitted'
    left join api_payload p on p.endpoint=r.endpoint and p.entity_key=r.entity_key
                           and p.payload_hash=r.payload_hash
   where m.state='member'
   group by m.player_tag, m.observed_at
  having count(*) = count(p.payload_json #>> '{clan,tag}')
     and count(distinct (p.payload_json #>> '{clan,tag}')) = 1
     and bool_and((p.payload_json #>> '{clan,tag}') ~ '^#[0289PYLQGRJCUV]{3,12}$')
)
update player_profile_membership m
   set clan_tag=observed.clan_tag, clan_observed_at=observed.observed_at
  from observed where m.player_tag=observed.player_tag;
comment on column player_profile_membership.clan_tag is
  '0305: normalized clan tag from this profile observation. Absent or conflicting observations have no clan tag.';
comment on column player_profile_membership.clan_observed_at is
  '0305: timestamp of the clan evidence. Only valid alongside the same observed_at; older projectors can advance state independently during deployment.';
