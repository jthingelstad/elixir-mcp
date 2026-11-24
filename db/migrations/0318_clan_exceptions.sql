-- 0318: Clan holds become member exceptions (Jamie, 2026-11-23).
--
-- A hold was one item per member, hold#<clan>#<tag> in clan_state: a
-- leader's "keep them" (kind 'leader', or no kind from before away
-- existed) or the member's own away (kind 'away'), with an end date or,
-- for a leader's, none. Exceptions replace it: named kinds (Keep in
-- clan, Keep as Elder, Not for Elder, Away), at most one running of each
-- kind per member, each with who can see it, and every one with an end
-- date. "No permanent exceptions": a hold with no end date is given one,
-- 90 days from this migration, not grandfathered.
--
-- This copies every hold into an exception item,
-- exception#<clan>#hold-<tag without #>, in the clan's partition and
-- listed by member (gsi1sk exception#<tag>#<set_at>#<id>):
--
--   kind 'away'            -> away, seen by the clan (as before: a
--                             member's away reached Elixir in their name)
--   kind 'leader' or none  -> keep_in_clan, seen by leaders only (a hold
--                             was leaders' business)
--   until as written       -> until; none -> now() + 90 days, with a
--                             'changed' event by Elixir (by null) marked
--                             migration '0318'
--   note (or an older reason), by, by_name, set_at -> the same, and the
--                             'added' event
--
-- Lossless: the hold's whole body rides along as `hold`, with
-- migrated_from 'hold' and migrated_at. A hold already past its end date
-- is copied too (it ran out; a member's history shows it), and an end
-- date further off than the new one-year cap is kept as written (the cap
-- is checked when an exception is set or changed). A hold with no
-- set_at takes this migration's time. The id is the member's, so a
-- re-run copies nothing (on conflict do nothing).
--
-- Expand and contract: from this deploy no code reads or writes hold#
-- items. The code serving while this commits is the old code, so a hold
-- set or cleared between this migration and the flip reaches only the
-- old item. The contract migration that deletes the hold# items first
-- copies any written after migrated_at, as 0229 promised for the voice.
--
-- Locks: reads the hold# items (a handful in production) and inserts as
-- many clan_state items; fail fast behind a writer.
--
-- vacuum after: clan_state
set local lock_timeout = '5s';
set local statement_timeout = '30s';

with holds as (
  select h.body,
         substr(h.body ->> 'gsi1pk', 6) as clan_tag,
         h.body ->> 'player_tag' as player_tag,
         h.body ->> 'kind' = 'away' as away,
         coalesce(h.body ->> 'note', h.body ->> 'reason') as note,
         nullif(h.body ->> 'until', '') as until,
         coalesce(nullif(h.body ->> 'set_at', ''),
                  to_char(now() at time zone 'utc',
                          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) as set_at,
         to_char(now() at time zone 'utc',
                 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at_now,
         to_char((now() + interval '90 days') at time zone 'utc',
                 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as given_until
    from clan_state h
   where h.pk like 'hold#%'
     and h.body ->> 'gsi1pk' like 'clan#%'
     and coalesce(h.body ->> 'player_tag', '') <> ''
),
shaped as (
  select h.*,
         'hold-' || ltrim(h.player_tag, '#') as exception_id,
         case when h.away then 'away' else 'keep_in_clan' end as kind,
         case when h.away then 'clan' else 'leaders' end as visibility
    from holds h
)
insert into clan_state (pk, body)
select 'exception#' || s.clan_tag || '#' || s.exception_id,
       jsonb_build_object(
         'pk', 'exception#' || s.clan_tag || '#' || s.exception_id,
         'gsi1pk', 'clan#' || s.clan_tag,
         'gsi1sk', 'exception#' || s.player_tag || '#' || s.set_at || '#' || s.exception_id,
         'exception_id', s.exception_id,
         'player_tag', s.player_tag,
         'player_name', null,
         'kind', s.kind,
         'visibility', s.visibility,
         'until', coalesce(s.until, s.given_until),
         'note', s.note,
         'set_by', s.body ->> 'by',
         'set_by_name', s.body ->> 'by_name',
         'set_at', s.set_at,
         'changed_at', case when s.until is null then s.at_now end,
         'changed_by', null,
         'changed_by_name', null,
         'ended_at', null,
         'ended_by', null,
         'ended_by_name', null,
         'events',
           jsonb_build_array(
             jsonb_build_object(
               'event', 'added',
               'at', s.set_at,
               'by', s.body ->> 'by',
               'by_name', s.body ->> 'by_name',
               'until', s.until,
               'visibility', s.visibility,
               'note', s.note
             )
           ) || case when s.until is null then
             jsonb_build_array(
               jsonb_build_object(
                 'event', 'changed',
                 'at', s.at_now,
                 'by', null,
                 'by_name', null,
                 'until', s.given_until,
                 'visibility', s.visibility,
                 'note', null,
                 'migration', '0318'
               )
             )
           else '[]'::jsonb end,
         'migrated_from', 'hold',
         'migrated_at', s.at_now,
         'hold', s.body - 'pk' - 'gsi1pk' - 'gsi1sk'
       )
  from shaped s
on conflict (pk) do nothing;
