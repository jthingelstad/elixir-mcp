-- 0191: the card table says which cards the current /cards catalog lists.
--
-- cards_catalog served every kind = 'support' row as a Tower Troop, and
-- answered five against the official four (issue #44, 2026-09-15). The
-- fifth, 29000000 "Archer Queen", was never sent by the API: no archived
-- /cards, profile or battle log payload carries it (the whole S3 archive,
-- read 2026-09-28). It is elixir-bot's unit-test fixture, a mocked /cards
-- response ({"items": [Knight], "supportItems": [{"name": "Archer Queen",
-- "id": 29000000}]}) that leaked into the bot's raw payload table on
-- 2026-05-28 with the two test stubs admission refused then; the
-- 2026-09-15 archive replay admitted it as a catalog fetch under the
-- backfill-elixir-bot gateway, and the projector, which heals and fills
-- from any fetch whatever its age, inserted the row confirmed. Support rows
-- also arrive as stubs from a battle's or a profile's supportCards (0091),
-- and catalog_seen_at cannot say "listed now": it moves only when a row's
-- fields change.
--
-- in_catalog is true while the newest admitted /cards fetch lists the
-- card. The projector moves it only on a fetch at least as new as the last
-- admitted one, and writes only the rows whose membership moved, so an
-- unchanged re-fetch still writes nothing. No row leaves the table.
--
-- The fill: a row /cards confirmed is taken as listed, unless the fetch
-- that confirmed it was a replay (a backfill-elixir-bot receipt at the
-- same instant): replayed history is not the current catalog. A stub
-- (null catalog_seen_at) is not listed. The next daily fetch corrects any
-- row this reads wrong either way. card is ~130 rows; the receipts are
-- read through api_receipt_entity (endpoint, entity_key).
--
-- A constant default is catalog-only; the fill touches the small card
-- table under its own lock, and ingest's stub writes wait at most an
-- instant.

set local lock_timeout = '5s';

alter table card add column in_catalog boolean not null default false;

update card c set in_catalog = true
 where c.catalog_seen_at is not null
   and not exists (
     select 1
       from api_receipt r
       join gateway g on g.gateway_id = r.gateway_id
      where r.endpoint = 'cards' and r.entity_key = 'GLOBAL'
        and r.fetched_at = c.catalog_seen_at
        and g.name = 'backfill-elixir-bot');

comment on column card.in_catalog is
  'True while the newest admitted /cards fetch lists this card (0191); false for a stub written from a battle or profile, a row only a replayed fetch confirmed, and a card the catalog no longer lists. The row stays either way.';
