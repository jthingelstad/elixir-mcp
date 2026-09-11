-- The card catalog and each player's collection become tables (Jamie,
-- 2026-09-11: the cards a player holds power deck-building suggestions
-- and card events - "unlocked Mega Knight" - and were a gap).
--
-- Until now both were read straight out of api_payload.payload_json:
-- the catalog from its one 'cards' row, the collection from the latest
-- 'player' row. 0071/0072 made that JSON a two-hour cache and exempted
-- the cards row by name; players_collection was not exempted and has
-- answered cards: [] for every profile older than two hours since. A
-- product-facing datum gets a projection; tools never read api_payload.
--
-- Levels are stored on the in-game 1-16 display scale like decks are
-- (contracts displayLevel, the one conversion); the catalog keeps the
-- API's rarity-relative max_level so the conversion can be made once at
-- write time and audited later.

create table card (
  card_id             integer primary key,
  name                text not null,
  kind                text not null check (kind in ('card', 'support')),
  rarity              text,
  elixir_cost         integer,
  max_level           integer,          -- the API's rarity-relative cap
  max_evolution_level integer,          -- form bit field: 1 evo, 2 hero
  icon_urls           jsonb,
  first_seen_at       timestamptz not null default now(),
  observed_at         timestamptz not null default now()
);
comment on table card is
  'The card and tower-troop catalog as last fetched from /cards; a card never leaves it.';

create table player_card (
  player_tag      text not null references player,
  card_id         integer not null,
  level           integer,              -- in-game 1-16 scale
  count           integer,
  evolution_level integer,              -- forms the player holds (bit field)
  star_level      integer,
  first_seen_at   timestamptz not null,
  observed_at     timestamptz not null,
  primary key (player_tag, card_id)
);
comment on table player_card is
  'Each recorded player''s collection as last observed on their profile: level (1-16), count toward the next level, forms unlocked.';

-- The catalog exists today: the cards payload row kept its JSON. Seed it
-- so nothing waits a day for the next daily fetch. Collections are NOT
-- backfilled (Jamie: no backfills); they fill as profiles are polled.
insert into card (card_id, name, kind, rarity, elixir_cost, max_level, max_evolution_level, icon_urls, first_seen_at, observed_at)
select (i->>'id')::int, i->>'name', 'card', i->>'rarity', (i->>'elixirCost')::int,
       (i->>'maxLevel')::int, (i->>'maxEvolutionLevel')::int, i->'iconUrls',
       p.last_fetched_at, p.last_fetched_at
from api_payload p, jsonb_array_elements(p.payload_json->'items') i
where p.endpoint = 'cards' and p.entity_key = 'GLOBAL' and p.payload_json is not null
  and p.payload_id = (select max(payload_id) from api_payload
                      where endpoint = 'cards' and entity_key = 'GLOBAL' and payload_json is not null)
on conflict (card_id) do nothing;

insert into card (card_id, name, kind, rarity, elixir_cost, max_level, max_evolution_level, icon_urls, first_seen_at, observed_at)
select (i->>'id')::int, i->>'name', 'support', i->>'rarity', (i->>'elixirCost')::int,
       (i->>'maxLevel')::int, (i->>'maxEvolutionLevel')::int, i->'iconUrls',
       p.last_fetched_at, p.last_fetched_at
from api_payload p, jsonb_array_elements(p.payload_json->'supportItems') i
where p.endpoint = 'cards' and p.entity_key = 'GLOBAL' and p.payload_json is not null
  and p.payload_id = (select max(payload_id) from api_payload
                      where endpoint = 'cards' and entity_key = 'GLOBAL' and payload_json is not null)
on conflict (card_id) do nothing;
