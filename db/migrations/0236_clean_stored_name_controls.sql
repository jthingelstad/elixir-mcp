-- 0236: the names already stored lose control characters and text-direction
-- overrides, the rule ingest has applied since 0235's change
-- (packages/ingest/src/names.mjs), so change the two together.
--
-- Jamie, 2026-11-07: "Approved: strip control and text-direction override
-- characters from stored player names". Direction marks (U+200E, U+200F,
-- U+061C), joiners and variation selectors stay. Clan and war rows take the
-- same rule, since ingest cleans every name. A name made only of these
-- characters becomes empty, as it does at ingest. Raw payloads are not touched.

set local lock_timeout = '5s';

update player
   set name = coalesce(nullif(btrim(regexp_replace(name, '[\x01-\x1f\x7f-\x9f‪-‮⁦-⁩]', '', 'g')), ''),
                       regexp_replace(name, '[\x01-\x1f\x7f-\x9f‪-‮⁦-⁩]', '', 'g'))
 where name ~ '[\x01-\x1f\x7f-\x9f‪-‮⁦-⁩]';

update clan
   set name = coalesce(nullif(btrim(regexp_replace(name, '[\x01-\x1f\x7f-\x9f‪-‮⁦-⁩]', '', 'g')), ''),
                       regexp_replace(name, '[\x01-\x1f\x7f-\x9f‪-‮⁦-⁩]', '', 'g'))
 where name ~ '[\x01-\x1f\x7f-\x9f‪-‮⁦-⁩]';

update war_week_clan
   set participant_name = coalesce(nullif(btrim(regexp_replace(participant_name, '[\x01-\x1f\x7f-\x9f‪-‮⁦-⁩]', '', 'g')), ''),
                                   regexp_replace(participant_name, '[\x01-\x1f\x7f-\x9f‪-‮⁦-⁩]', '', 'g'))
 where participant_name ~ '[\x01-\x1f\x7f-\x9f‪-‮⁦-⁩]';
