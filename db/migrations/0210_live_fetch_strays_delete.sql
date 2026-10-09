-- 0210: the record live_fetch left for two untracked players leaves it.
--
-- Before 0209 (MCP 11.5.1) a live_fetch of /players/{tag} was admitted
-- and projected like a scheduled poll, so a player nobody tracks entered
-- the record. Jamie, 2026-10-08: "Approved: delete the full record
-- footprint of untracked live_fetch tags" for three untracked tags
-- admitted by the pre-11.5.1 live_fetch path. {tag_footprint} read every
-- table with a tag column before this was written. Two of the three hold
-- exactly one live-lane admission each and what it projected: the player
-- row (named, with its clan), 107 and 136 badges, 125 and 127 cards, one
-- Path of Legends season, one profile membership, one daily snapshot,
-- two progress rows for one of them, one poll_state row, one receipt and
-- one payload row each. No recording, claim, nickname, membership,
-- battle or event names either. The third is not here: its player row
-- came from an account adding the player (a claim recording, since
-- stopped), not from live_fetch, whose reads of it all failed; the
-- deletion stops short of anything a claim made.
--
-- Not here: the job rows and fetch errors (operational, pruned on their
-- own clocks), the mcp_call_audit rows (the call log, not the record),
-- the clan row the profile upserted (a clan's, shared), and the two
-- payload archive objects in S3 (no migration reaches the bucket, and
-- nothing is granted s3:DeleteObject; NOTES 2026-10-08 has the ask).
--
-- The guard refuses, and so stops the deploy before the flip, if either
-- tag has become recorded since the read: an active recording, a claim,
-- a battle, a membership, an event, or a receipt from any lane but the
-- one live read. Then each delete is scoped by the tag literal, children
-- before the player row, so a foreign key the read did not see fails
-- the migration rather than cascading. A re-run deletes nothing. Small
-- index deletes (about 520 rows in all); the lock timeout fails fast
-- behind a long reader rather than queue ingest.

set local lock_timeout = '5s';

do $$
declare
  tags constant text[] := array['#VL9ULV8RL', '#UYPLUQ0U9'];
  why text;
begin
  select string_agg(reason, ', ') into why from (
    select 'active recording' as reason from recording
     where subject_tag = any(tags) and status = 'active'
    union all
    select 'claim' from claim where player_tag = any(tags)
    union all
    select 'battle' from battle_participant where player_tag = any(tags)
    union all
    select 'membership' from clan_membership where player_tag = any(tags)
    union all
    select 'player event' from player_event where player_tag = any(tags)
    union all
    select 'clan event' from clan_event where player_tag = any(tags)
    union all
    select 'non-live receipt' from api_receipt r
      left join job j on j.job_id = r.job_id
     where r.entity_key = any(tags) and j.lane is distinct from 'live'
  ) r;
  if why is not null then
    raise exception '0210: a tag is recorded now (%); nothing deleted', why;
  end if;
end $$;

delete from player_badge where player_tag in ('#VL9ULV8RL', '#UYPLUQ0U9');
delete from player_card where player_tag in ('#VL9ULV8RL', '#UYPLUQ0U9');
delete from player_pol_season where player_tag in ('#VL9ULV8RL', '#UYPLUQ0U9');
delete from player_profile_membership where player_tag in ('#VL9ULV8RL', '#UYPLUQ0U9');
delete from player_progress_daily where player_tag in ('#VL9ULV8RL', '#UYPLUQ0U9');
delete from player_snapshot_daily where player_tag in ('#VL9ULV8RL', '#UYPLUQ0U9');
delete from player where player_tag in ('#VL9ULV8RL', '#UYPLUQ0U9');
delete from poll_state where subject_tag in ('#VL9ULV8RL', '#UYPLUQ0U9');
delete from api_receipt where entity_key in ('#VL9ULV8RL', '#UYPLUQ0U9');
delete from api_payload where entity_key in ('#VL9ULV8RL', '#UYPLUQ0U9');
