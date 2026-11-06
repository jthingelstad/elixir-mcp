-- 0234: the names already stored lose the colour markup Clash Royale lets a
-- player type into a name (`<c2>Name`), so every reader gets the clean name.
-- New results are cleaned at ingest (packages/ingest/src/names.mjs); this is
-- the same rule, so change the two together.
--
-- Jamie, 2026-11-06: "Approved to fix all 10 items.", the design critique's
-- second, which says stripping "must also cover names already stored".
--
-- A few hundred player rows and a few clan rows change, so the
-- scan is the cost, not the writes. A name that is nothing but markup keeps
-- what the player typed. Raw payloads are not touched.

set local lock_timeout = '5s';

update player
   set name = coalesce(
         nullif(btrim(regexp_replace(name, '<\s*[cC][0-9]+\s*>|<[\\/][cC]>', '', 'g')), ''),
         name)
 where name ~ '<\s*[cC][0-9]+\s*>|<[\\/][cC]>';

update clan
   set name = coalesce(
         nullif(btrim(regexp_replace(name, '<\s*[cC][0-9]+\s*>|<[\\/][cC]>', '', 'g')), ''),
         name)
 where name ~ '<\s*[cC][0-9]+\s*>|<[\\/][cC]>';

update war_week_clan
   set participant_name = coalesce(
         nullif(btrim(regexp_replace(participant_name, '<\s*[cC][0-9]+\s*>|<[\\/][cC]>', '', 'g')), ''),
         participant_name)
 where participant_name ~ '<\s*[cC][0-9]+\s*>|<[\\/][cC]>';
