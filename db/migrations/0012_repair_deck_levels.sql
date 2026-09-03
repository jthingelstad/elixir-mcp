-- 0012: repair the 0011 level backfill, which ran against an EMPTY card
-- catalog in prod (the cards endpoint was never scheduled — fixed in the
-- same change series) and therefore norm-stamped decks without
-- converting them.
--
-- Discriminator: ingest code that slims display-scale levels went live
-- when IngestFunction updated at 2026-09-03T22:03:36Z (CloudFormation
-- stack event). Battles FIRST observed before that instant carry
-- old-code raw decks (enrich-on-dedup never overwrites a deck, so later
-- re-observations don't flip the class); battles first observed after it
-- carry display decks. Converted rows are stamped norm = 2, making this
-- migration idempotent; norm >= 1 always means display scale.

do $$
begin
  -- Fresh databases have nothing to repair; the guard only bites where
  -- repairable rows exist without the catalog to repair them with.
  if exists (
       select 1 from battle_participant bp
       where bp.deck is not null
         and (bp.deck ->> 'norm') is distinct from '2'
         and (
           select min(ar.fetched_at)
           from battle_observation bo
           join api_receipt ar on ar.receipt_id = bo.receipt_id
           where bo.battle_id = bp.battle_id
         ) < '2026-09-03T22:03:36Z'
     )
     and not exists (
       select 1 from api_payload
       where endpoint = 'cards' and entity_key = 'GLOBAL'
     ) then
    raise exception
      '0012 requires the recorded card catalog; none found — let the daily cards poll land first';
  end if;
end $$;

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

create function pg_temp.norm_cards12(cards jsonb) returns jsonb
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

update battle_participant bp
set deck =
  case
    when bp.deck ? 'rounds' then
      jsonb_set(
        bp.deck || '{"norm": 2}'::jsonb, '{rounds}',
        (select coalesce(
           jsonb_agg(
             jsonb_set(r, '{cards}', pg_temp.norm_cards12(r -> 'cards'))
             order by ord),
           '[]'::jsonb)
         from jsonb_array_elements(bp.deck -> 'rounds') with ordinality t(r, ord)))
    else
      jsonb_set(
        (case
           when bp.deck ? 'supportCards' then
             jsonb_set(
               bp.deck || '{"norm": 2}'::jsonb, '{supportCards}',
               pg_temp.norm_cards12(bp.deck -> 'supportCards'))
           else bp.deck || '{"norm": 2}'::jsonb
         end),
        '{cards}',
        pg_temp.norm_cards12(bp.deck -> 'cards'))
  end
where bp.deck is not null
  and (bp.deck ->> 'norm') is distinct from '2'
  and (
    select min(ar.fetched_at)
    from battle_observation bo
    join api_receipt ar on ar.receipt_id = bo.receipt_id
    where bo.battle_id = bp.battle_id
  ) < '2026-09-03T22:03:36Z';

drop function pg_temp.norm_cards12(jsonb);
drop table _card_caps;
