-- 0281: a close friend is a private mark on a follow.
--
-- Jamie, 2026-11-16: "I love 'your circle this week'... a way to show
-- close friends versus just follows." A person marks some of the players
-- they follow as close friends; Home's circle tells how those few played
-- this week, and the feed can show only them.
--
-- The mark lives on the follow itself, the friend claim, never beside it:
-- removing the follow takes the mark with it, and nothing else reads the
-- column. It is private to the account that set it (DECISIONS "A close
-- friend is a private mark"): the other person is never told, and no
-- player page, account page, follow list or MCP tool shows it.
--
-- Only a friend claim carries it (the check): your own players and the
-- players you watch are not friends. A linked follow (0277) keeps it in
-- step across the account's Verified players in code
-- (packages/claims/src/close.mjs).
--
-- A constant default on a new column rewrites no rows.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table claim
  add column close boolean not null default false,
  add constraint claim_close_is_friend
    check (not close or (relationship = 'friend' and not is_primary));

comment on column claim.close is
  '0281: a close friend, the account''s private mark on its friend follow (Jamie, 2026-11-16). Never shown to anyone but the account.';
