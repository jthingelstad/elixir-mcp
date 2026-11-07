-- 0237: colour markup a control character used to split, such as `<c`, U+202E,
-- `2>Name`, was whole again once 0236 removed the character, and 0234 and 0235
-- had already run. Ingest removes control characters first and markup second
-- (packages/ingest/src/names.mjs), so this applies the markup rule of 0234 and
-- 0235 once more, in that order. The same approvals cover it. A name that is
-- nothing but markup keeps what the player typed. Raw payloads are not touched.

set local lock_timeout = '5s';

update player
   set name = coalesce(nullif(btrim(regexp_replace(name, '<\s*[cC][0-9]+\s*>|<[\\/][cC]>|<[cC]/>', '', 'g')), ''), name)
 where name ~ '<\s*[cC][0-9]+\s*>|<[\\/][cC]>|<[cC]/>';

update clan
   set name = coalesce(nullif(btrim(regexp_replace(name, '<\s*[cC][0-9]+\s*>|<[\\/][cC]>|<[cC]/>', '', 'g')), ''), name)
 where name ~ '<\s*[cC][0-9]+\s*>|<[\\/][cC]>|<[cC]/>';

update war_week_clan
   set participant_name = coalesce(nullif(btrim(regexp_replace(participant_name, '<\s*[cC][0-9]+\s*>|<[\\/][cC]>|<[cC]/>', '', 'g')), ''), participant_name)
 where participant_name ~ '<\s*[cC][0-9]+\s*>|<[\\/][cC]>|<[cC]/>';
