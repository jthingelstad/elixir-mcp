-- 0208: membership rows opened on their clan's first read are baselines.
-- 0207 marked a first sight `baseline` from then on and left the rows
-- written before it as they were, narrated as joins, with the cleanup as
-- Jamie's call. The read-only census ({membership_baseline_census},
-- docs/NOTES.md 2026-10-08) counted 35 such rows across 11 clans, the
-- earliest from 2026-03-12, the latest the journey's #GGJG2CCR at
-- 2026-10-08 21:32Z, and no member_joined event from a follow burst.
-- Jamie, 2026-10-08: "Approved: mark the 35 first-read membership rows as
-- baseline in elixir production".
-- The criteria are the census's own, unchanged: a membership row whose
-- joined_observed_at is its clan's earliest joined_observed_at (the
-- clan's first membership observation) and that is not yet baseline.
-- Only `baseline` changes; no row is deleted or re-keyed. A second run
-- changes nothing. Moments are not stored: players_timeline derives
-- clan_joined from clan_membership and skips a baseline row
-- (packages/tools/src/activity/entries.mjs), so the 35 "joined" moments
-- go with the flag.
-- Locks: clan_membership (182 rows on 2026-10-08) row locks on the rows
-- it marks, for an instant; fail fast behind a reader.
set local lock_timeout = '5s';

with firsts as (
  select clan_tag, min(joined_observed_at) as first_at
    from clan_membership
   group by clan_tag)
update clan_membership cm
   set baseline = true
  from firsts f
 where f.clan_tag = cm.clan_tag
   and f.first_at = cm.joined_observed_at
   and not cm.baseline;

comment on column clan_membership.baseline is
  '0207: the row opened on a baseline read (the clan''s first read, or the first read that recorded this member): Elixir first saw the player here and did not observe a join. 0208 marked the rows written before 0207 on their clan''s first read (Jamie, 2026-10-08); other rows before 0207 read false.';
