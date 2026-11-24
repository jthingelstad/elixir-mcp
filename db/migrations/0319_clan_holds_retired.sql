-- 0319: the retired Clan hold# items leave clan_state (the contract half of 0318).
--
-- 0318 (Jamie, 2026-11-23: holds become member exceptions) copied every
-- hold#<clan>#<tag> item into exception#<clan>#hold-<tag without #>,
-- carrying the hold's whole body as `hold`, and kept the hold items. Its
-- deploy shipped code that never reads or writes them (the ledger's hold
-- methods are gone), so from that flip on they are dead rows. Production
-- went from 1327 to 1329 clan_state items at 0318: two holds. Jamie,
-- 2026-11-24, approved finishing the contract ("proceed with the rest").
--
-- 0318 promised that this migration first copies any hold written after
-- it: the old code served until the flip, so a hold set in that window
-- reached only the old item. Step one copies each hold that has no copy
-- yet, in exactly 0318's shape (a hold with no end date ends 90 days
-- from now, with a 'changed' event by Elixir marked migration '0319'),
-- and an exception already there wins (on conflict do nothing).
--
-- Step two deletes a hold only when its copy exists and still carries
-- this hold's body unchanged (the copy's `hold` equals the item less its
-- keys; the exception writers spread the whole item, so a leader's later
-- change to the exception keeps `hold`). Kept, never read, and gone with
-- the clan's other items in deleteClan:
--   - a hold that 0318 and step one both skip: no clan#<tag> gsi1pk or
--     no player_tag. The old putHold always wrote both, so none should
--     exist;
--   - a hold the old code rewrote after 0318 copied it (the same member
--     held again before the flip): its copy holds the earlier body.
-- Either can only come from the minutes between 0318's commit and the
-- flip on 2026-11-23, over a ledger that held two holds, so at most a
-- couple, and most likely none.
--
-- Not done: a hold the old code cleared in that window left its copy
-- running. It ends on its own date (at most 90 days for one that had
-- none) and a leader can end it on Run > Exceptions.
--
-- Re-run: step one finds every remaining hold copied, step two finds
-- nothing left that matches, so a second run writes nothing.
--
-- Locks: row locks on a handful of clan_state items; fail fast behind a
-- writer.
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
                 'migration', '0319'
               )
             )
           else '[]'::jsonb end,
         'migrated_from', 'hold',
         'migrated_at', s.at_now,
         'hold', s.body - 'pk' - 'gsi1pk' - 'gsi1sk'
       )
  from shaped s
on conflict (pk) do nothing;

delete from clan_state h
 using clan_state e
 where h.pk like 'hold#%'
   and h.body ->> 'gsi1pk' like 'clan#%'
   and coalesce(h.body ->> 'player_tag', '') <> ''
   and e.pk = 'exception#' || substr(h.body ->> 'gsi1pk', 6)
              || '#hold-' || ltrim(h.body ->> 'player_tag', '#')
   and e.body ->> 'migrated_from' = 'hold'
   and e.body -> 'hold' = h.body - 'pk' - 'gsi1pk' - 'gsi1sk';
