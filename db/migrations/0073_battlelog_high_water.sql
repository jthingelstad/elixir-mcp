-- The last battle each observer's log has delivered (Jamie, 2026-09-11:
-- "why are we even sending the data to Postgres for a battle that was
-- already recorded?").
--
-- A battlelog is the player's last 25 battles, and a poll resubmits all
-- of them. The guarded upsert (b1d1dcb) stopped that from WRITING, but
-- every poll still probed ~85 index entries to find out there was
-- nothing to do. With the high-water mark known, ingest drops every
-- battle at or before it before touching a table - the log is
-- chronological and contiguous, so a battle older than the newest one
-- this observer's log has already delivered was in that earlier
-- delivery too.
--
-- Per OBSERVER, not per player: a player also appears in opponents'
-- logs, and a mark taken from those could sit past battles this
-- observer's own log has never delivered. Replayed history (a fetch
-- older than 24h) neither consults nor advances the mark.
--
-- It also states the capture audit plainly: a full log whose oldest
-- battle is newer than the mark has rolled past battles we never saw.

create table battlelog_high_water (
  observer_tag  text primary key references player,
  battle_time   timestamptz not null,
  updated_at    timestamptz not null default now()
);

comment on table battlelog_high_water is
  'The newest battle_time each observer''s own battlelog has delivered. Ingest skips battles at or before it; a full log starting after it is a capture gap.';

-- Seed from what each observer has already delivered.
insert into battlelog_high_water (observer_tag, battle_time)
select o.observer_tag, max(b.battle_time)
from battle_observation o
join battle b on b.battle_id = o.battle_id
join player p on p.player_tag = o.observer_tag
group by o.observer_tag;
