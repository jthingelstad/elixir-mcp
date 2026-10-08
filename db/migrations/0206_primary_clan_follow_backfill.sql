-- 0206: Elixir follows the primary player's clan for accounts made before
-- 0205 too.
-- 0205 added account.auto_follow_clan false for every account that existed
-- then, leaving the backfill as Jamie's call. Jamie, 2026-10-08:
-- "Approved: backfill auto_follow_clan for the 35 existing elixir accounts".
-- This turns the switch on for exactly the accounts the follow can apply
-- to: people (kind 'person'), approved, made before 0205 was applied
-- (schema_migrations id 205), and still off. Agents and integrations are
-- among the 35 but never follow a clan this way (followPrimaryClan skips
-- them), and an account that is not approved is left as it was.
-- No follow is written here. Each account's follow happens on its primary
-- player's next admitted profile (packages/claims followClanForPlayer),
-- under every rule of followPrimaryClan: a free activity slot, never a
-- clan the person stopped tracking, nothing when the clan is already
-- followed. Each follow is an account_event and a primary_clan_followed
-- log line.
-- Locks: account (tens of rows) row locks for an instant; fail fast
-- behind a reader.
set local lock_timeout = '5s';

update account
   set auto_follow_clan = true
 where not auto_follow_clan
   and kind = 'person'
   and status = 'approved'
   and created_at < (select applied_at from schema_migrations where id = 205);

comment on column account.auto_follow_clan is
  '0205: Elixir may follow the primary player''s clan at activity scope; true by default. 0206 turned it on for the approved people made before 0205 (Jamie, 2026-10-08).';
