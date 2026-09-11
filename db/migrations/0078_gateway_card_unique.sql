-- 0078: the operator picks the card (Jamie, 2026-09-11: running a
-- collector is a favour, so the favour gets to pick its favourite card).
-- A card is one collector's, so the pick is unique among LIVE gateways;
-- a revoked collector releases its card. The 0019 deterministic pick
-- could land two collectors on one card, and this index will not admit
-- that: the later twin loses its card here and the lazy assignment
-- hands it a free one on the next fleet read.
update gateway g
   set card_name = null, card_icon = null
 where g.status <> 'revoked' and g.card_name is not null
   and exists (select 1 from gateway o
               where o.status <> 'revoked' and o.card_name = g.card_name
                 and (o.enrolled_at, o.gateway_id) < (g.enrolled_at, g.gateway_id));

create unique index gateway_card_name_live_uniq
  on gateway (card_name) where status <> 'revoked';
