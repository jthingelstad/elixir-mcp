-- 0275: Index the places on the player map, for the player map and Near
-- you (#768). A person's place is a Clan ledger item, `place#<tag>`,
-- written under each of their verified tags; since this change it carries
-- `player_map: true` when its owner chose to be on the player map (an
-- older place has no such key and stays on clan maps only). The player
-- map reads every such place, and Near you the ones in the reader's
-- country and region. No index served either: clan_state's primary key is
-- in the database's collation and the place items carry no listing
-- partition, so both reads were a Seq Scan of the whole ledger
-- (services/migrate/test/player-map-plan.test.mjs). This partial index
-- holds the places on the player map alone, keyed by country and region;
-- its predicate is the readers' own, word for word, so the planner
-- matches it. Records and query semantics are unchanged. The ledger is
-- Clan's own small table; the build takes a SHARE lock (reads continue, a
-- Clan write waits a moment). Fail fast behind a conflicting writer; the
-- deploy retries.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create index clan_state_player_map
  on clan_state ((body ->> 'country'), (coalesce(body ->> 'region', '')))
  where pk ~ '^place##[0289PYLQGRJCUV]{3,12}$'
    and body ->> 'player_map' = 'true';

comment on index clan_state_player_map is
  'The places on the player map alone (0275), by country and region, for the player map and Near you. The predicate is the readers'' (packages/auth/src/clan-context.mjs), word for word.';
