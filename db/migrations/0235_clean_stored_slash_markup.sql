-- 0235: the names already stored lose `<c/>`, a form of the colour markup 0234
-- did not know. New results are cleaned at ingest
-- (packages/ingest/src/names.mjs); this is the same rule, so change them together.
--
-- Jamie, 2026-11-06: "Approved: strip <c/> from player names at ingest and in
-- stored names". Control characters are ingest only, as approved, so this
-- leaves them. A name that is nothing but markup keeps what the player typed.
-- Raw payloads are not touched.

set local lock_timeout = '5s';

update player
   set name = coalesce(nullif(btrim(regexp_replace(name, '<\s*[cC][0-9]+\s*>|<[\\/][cC]>|<[cC]/>', '', 'g')), ''), name)
 where name ~ '<[cC]/>';

update clan
   set name = coalesce(nullif(btrim(regexp_replace(name, '<\s*[cC][0-9]+\s*>|<[\\/][cC]>|<[cC]/>', '', 'g')), ''), name)
 where name ~ '<[cC]/>';

update war_week_clan
   set participant_name = coalesce(nullif(btrim(regexp_replace(participant_name, '<\s*[cC][0-9]+\s*>|<[\\/][cC]>|<[cC]/>', '', 'g')), ''), participant_name)
 where participant_name ~ '<[cC]/>';
