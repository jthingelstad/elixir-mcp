-- 0276: A place is a place (Jamie, 2026-11-15). A person's place, the
-- Clan ledger item `place#<tag>` written under each of their verified
-- tags, shows on their clans' maps, on the player map and in Near you,
-- with no choice of who sees it. The consent machinery of #1054 (a
-- `player_map` key that was true, false or absent) is removed with this
-- change, and so is the read rule's fallback for rows saved before the
-- owner stamp (#1057): after this migration every place row carries its
-- owner's `account_id`, and a place counts for a claim only when the
-- stamp equals the claim's account.
--
-- Over the place rows alone (a few dozen in production; written safe for
-- many more: three set-based statements, no loop):
--
-- 1. Delete every place row that no current verified own claim (primary
--    or alt) owns under the rule the readers use today: a stamped row
--    whose stamp is the claim's account, or an unstamped row written at
--    or after the claim was verified (or under a claim verified before
--    that column existed). What goes is a former owner's place left
--    behind a moved or removed tag: another person's stale personal
--    data that no reader shows.
-- 2. Stamp each remaining unstamped row with its claim's account (one
--    verified claim per tag, claim_one_verified_per_tag), and drop the
--    `player_map` key from every place row.
-- 3. Replace 0275's partial index, whose predicate tested `player_map`,
--    with one over every place row by country and region. Its predicate
--    is the readers' own, word for word
--    (packages/auth/src/clan-context.mjs), so the player map and Near you
--    still never scan the ledger whole
--    (services/migrate/test/player-map-plan.test.mjs).
--
-- Re-running changes nothing: no row is unowned, unstamped or carries
-- the key. A malformed set_at counts as not written after the claim was
-- verified, rather than failing the deploy. The ledger is Clan's own
-- small table; the writes and the index build hold its locks for an
-- instant. Fail fast behind a conflicting writer; the deploy retries.
--
-- vacuum after: clan_state
set local lock_timeout = '5s';
set local statement_timeout = '30s';

delete from clan_state s
 where s.pk like 'place#%'
   and not exists (
     select 1 from claim c
      where s.pk = 'place#' || c.player_tag
        and c.status = 'verified'
        and (c.is_primary or c.relationship in ('primary', 'alt'))
        and (s.body ->> 'account_id' = c.account_id::text
             or (s.body ->> 'account_id' is null
                 and (c.verified_at is null
                      or (case when s.body ->> 'set_at'
                                    ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$'
                               then (s.body ->> 'set_at')::timestamptz
                          end) >= c.verified_at))));

update clan_state s
   set body = (s.body || jsonb_build_object('account_id', c.account_id::text))
              - 'player_map',
       updated_at = now()
  from claim c
 where s.pk like 'place#%'
   and s.pk = 'place#' || c.player_tag
   and c.status = 'verified'
   and (c.is_primary or c.relationship in ('primary', 'alt'))
   and (s.body ->> 'account_id' is null or s.body ? 'player_map');

drop index if exists clan_state_player_map;

create index if not exists clan_state_place
  on clan_state ((body ->> 'country'), (coalesce(body ->> 'region', '')))
  where pk ~ '^place##[0289PYLQGRJCUV]{3,12}$';

comment on index clan_state_place is
  'Every person''s place (0276), by country and region, for the player map and Near you. The predicate is the readers'' (packages/auth/src/clan-context.mjs), word for word.';
