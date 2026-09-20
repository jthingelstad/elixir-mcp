-- A card that names a deck without being its win condition (design
-- 2026-09-20, the Rune Giant read): the tank of an enchanted chip push
-- that the deck sites lead the name with. Read by the classifier only
-- when no win condition is in the deck; never a win condition.
alter table card_role add column names_deck boolean not null default false;
