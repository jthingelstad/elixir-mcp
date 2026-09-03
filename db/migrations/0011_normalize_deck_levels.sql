-- 0011: normalize stored deck card levels to the in-game display scale.
--
-- API levels are rarity-relative (a maxed legendary reports 8/8, the game
-- shows 16/16). Ingest now converts at the seam (contracts displayLevel)
-- and stamps deck->'norm' = 1; this backfill converts every unstamped
-- deck using the recorded card catalog's maxLevel, then stamps it — so
-- rows ingested by new code during the deploy window are never
-- double-shifted. display = level + (16 - maxLevel).

drop table if exists _card_caps;
create temporary table _card_caps as
select distinct on (id)
       (item ->> 'id')::bigint as id,
       (item ->> 'maxLevel')::int as max_level
from (
  select payload_json
  from api_payload
  where endpoint = 'cards' and entity_key = 'GLOBAL'
  order by last_fetched_at desc
  limit 1
) p
cross join lateral jsonb_array_elements(
  coalesce(p.payload_json -> 'items', '[]'::jsonb) ||
  coalesce(p.payload_json -> 'supportItems', '[]'::jsonb)
) item;

create function pg_temp.norm_cards(cards jsonb) returns jsonb
language sql as $$
  select coalesce(
    jsonb_agg(
      case
        when (c ->> 'level') is not null and cap.max_level is not null
        then jsonb_set(
               c, '{level}',
               to_jsonb((c ->> 'level')::int + 16 - cap.max_level))
        else c
      end
      order by ord),
    '[]'::jsonb)
  from jsonb_array_elements(cards) with ordinality t(c, ord)
  left join _card_caps cap on cap.id = (c ->> 'id')::bigint
$$;

update battle_participant
set deck =
  case
    when deck ? 'rounds' then
      jsonb_set(
        deck || '{"norm": 1}'::jsonb, '{rounds}',
        (select coalesce(
           jsonb_agg(
             jsonb_set(r, '{cards}', pg_temp.norm_cards(r -> 'cards'))
             order by ord),
           '[]'::jsonb)
         from jsonb_array_elements(deck -> 'rounds') with ordinality t(r, ord)))
    else
      jsonb_set(
        (case
           when deck ? 'supportCards' then
             jsonb_set(
               deck || '{"norm": 1}'::jsonb, '{supportCards}',
               pg_temp.norm_cards(deck -> 'supportCards'))
           else deck || '{"norm": 1}'::jsonb
         end),
        '{cards}',
        pg_temp.norm_cards(deck -> 'cards'))
  end
where deck is not null
  and (deck ->> 'norm') is null;

drop function pg_temp.norm_cards(jsonb);
drop table _card_caps;
