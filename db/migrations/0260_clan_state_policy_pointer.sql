-- 0260: Index the Clan ledger's policy pointers for the clan directory (#768).
-- The directory (readClanDirectory) lists every clan whose `policy#<clan>`
-- pointer names a saved version. No index served that: clan_state's
-- primary key is in the database's collation, so the anchored pattern
-- cannot range over it, and the pointer carries no listing partition. On
-- a scratch ledger of thirty thousand other rows the read was a Seq Scan
-- of the whole ledger, every Action, verdict and schedule body, for a few
-- dozen pointers (services/migrate/test/clan-directory-plan.test.mjs).
-- This partial index holds the pointers alone; its predicate is the
-- reader's own pattern, word for word, so the planner matches it.
-- Records and query semantics are unchanged. The ledger is Clan's own
-- small table; the build takes a SHARE lock (reads continue, a Clan write
-- waits a moment). Fail fast behind a conflicting writer; the deploy
-- retries.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create index clan_state_policy_pointer on clan_state (pk)
  where pk ~ '^policy##[0289PYLQGRJCUV]{3,12}$';

comment on index clan_state_policy_pointer is
  'The policy pointers alone (0260), for the clan directory: one row per clan that saved a policy. The predicate is readClanDirectory''s pattern, word for word.';
