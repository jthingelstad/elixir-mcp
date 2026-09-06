-- The player as a game entity (CONSUMER-SURFACES §7.2).
--
-- Every recorded player payload carries the player's arena, best
-- trophies, favourite card, clan badge, clan role, and ~139 badges. We
-- projected none of it. `players_profile` could answer a name and a
-- clan tag and nothing else about the player, so a consumer that wanted
-- the clan badge, the clan role, or how long someone had played had to
-- spend a LIVE Clash Royale read on facts already sitting in our own
-- retained payloads.
--
-- These are game facts about a player. They belong here whoever asked.

-- Arena and favourite card are ids; names and icons resolve from the
-- card catalog at read time. Never store an icon URL (§7.2).
alter table player_snapshot_daily add column arena_id int;
alter table player_snapshot_daily add column best_trophies int;
alter table player_snapshot_daily add column favorite_card_id int;

-- The clan's own badge, not the player's.
alter table clan add column badge_id int;

-- The player's role in their current clan, alongside last_known_clan_tag
-- and with the same meaning: as of the most recent player payload.
-- clan_membership.role stays the roster-derived history; this is the
-- player's own account of it, and a player recorded on their own has no
-- membership row at all.
alter table player add column last_known_clan_role text;

-- Badges are current state, not a daily blob. Storing ~139 per player
-- per day would be the single largest thing we write, to say almost
-- nothing new each time.
create table player_badge (
  player_tag  text not null references player,
  name        text not null,
  level       int,
  max_level   int,
  progress    int,
  target      int,
  observed_at timestamptz not null,
  primary key (player_tag, name)
);

comment on table player_badge is
  'Current badge state per player, upserted when a payload observes a change. YearsPlayed.progress is DAYS played, which is how account age is derived.';

create index player_badge_name on player_badge (name);

-- Backfill from the payloads we already retained. Player profiles poll
-- on a multi-day floor, so waiting for natural traffic would leave
-- every recorded player without these fields for days. Newest retained
-- payload per player wins.
with newest as (
  select distinct on (entity_key)
         entity_key as player_tag, payload_json as payload, last_fetched_at
  from api_payload
  where endpoint = 'player'
  order by entity_key, last_fetched_at desc
)
update player p set
  last_known_clan_role = case
    when p.last_known_clan_tag is not null
    then nullif(n.payload -> 'role', 'null'::jsonb) #>> '{}'
    else p.last_known_clan_role end
from newest n where n.player_tag = p.player_tag;

with newest as (
  select distinct on (entity_key)
         entity_key as player_tag, payload_json as payload
  from api_payload
  where endpoint = 'player'
  order by entity_key, last_fetched_at desc
)
update clan c set badge_id = coalesce(c.badge_id, (n.payload -> 'clan' ->> 'badgeId')::int)
from newest n
where c.clan_tag = (n.payload -> 'clan' ->> 'tag')
  and n.payload -> 'clan' ->> 'badgeId' is not null;

-- Attributes onto the most recent snapshot row for each player.
with newest as (
  select distinct on (entity_key)
         entity_key as player_tag, payload_json as payload
  from api_payload
  where endpoint = 'player'
  order by entity_key, last_fetched_at desc
),
latest_snapshot as (
  select distinct on (player_tag) player_tag, snapshot_date, snapshot_kind
  from player_snapshot_daily
  order by player_tag, snapshot_date desc, snapshot_kind desc
)
update player_snapshot_daily s set
  arena_id = (n.payload -> 'arena' ->> 'id')::int,
  best_trophies = (n.payload ->> 'bestTrophies')::int,
  favorite_card_id = (n.payload -> 'currentFavouriteCard' ->> 'id')::int
from newest n, latest_snapshot l
where s.player_tag = n.player_tag
  and s.player_tag = l.player_tag
  and s.snapshot_date = l.snapshot_date
  and s.snapshot_kind = l.snapshot_kind;

insert into player_badge (player_tag, name, level, max_level, progress, target, observed_at)
select n.player_tag, b.name, b.level, b."maxLevel", b.progress, b.target, n.last_fetched_at
from (
  select distinct on (entity_key)
         entity_key as player_tag, payload_json as payload, last_fetched_at
  from api_payload
  where endpoint = 'player'
  order by entity_key, last_fetched_at desc
) n
cross join lateral jsonb_to_recordset(n.payload -> 'badges')
  as b(name text, level int, "maxLevel" int, progress int, target int)
-- jsonb_to_recordset takes the payload's own key names, so maxLevel is
-- quoted here and mapped to max_level by column position on insert.
where jsonb_typeof(n.payload -> 'badges') = 'array' and b.name is not null
  and exists (select 1 from player p where p.player_tag = n.player_tag)
on conflict (player_tag, name) do nothing;
