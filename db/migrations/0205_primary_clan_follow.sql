-- 0205: Elixir follows the primary player's clan automatically.
-- Jamie, 2026-10-08: "it should follow it automatically for the primary
-- player assuming they have a clan set (not all players are in a clan)."
-- The first-ten-minutes assessment that day found that no new account
-- followed a clan: the one-click offer sat on Tracking, and adding a tag
-- jumps to the player's own page, so it was never seen.
--   account.auto_follow_clan: whether Elixir may follow this account's
--     primary player's clan. Every account that exists before this
--     migration is false (added with a constant false default, so no row
--     is written), and the default then turns true for new accounts. The
--     existing accounts are not backfilled: that is Jamie's call.
--   account_clan.auto_followed_at: set when Elixir followed the clan, and
--     cleared when the person changes that follow themselves. Only a row
--     carrying it is ever moved by Elixir; a person's own follow never is.
--   account_clan_declined: a clan the person stopped tracking. Elixir
--     never follows it for them automatically again; tracking it by hand
--     still works.
-- The rules live in packages/claims (followPrimaryClan) and the public
-- docs (recording.md, "Your player's clan"). No row is written here.
-- Locks: account and account_clan (both small, catalog-only changes) for
-- an instant; fail fast behind a reader.
set local lock_timeout = '5s';

alter table account add column auto_follow_clan boolean not null default false;
alter table account alter column auto_follow_clan set default true;
comment on column account.auto_follow_clan is
  '0205: Elixir may follow the primary player''s clan at activity scope. False for every account made before 0205 (not backfilled), true by default after.';

alter table account_clan add column auto_followed_at timestamptz;
comment on column account_clan.auto_followed_at is
  '0205: when Elixir followed this clan as the primary player''s clan. Null for a follow the person made or has since changed; only a non-null row is ever moved by Elixir.';

create table account_clan_declined (
  account_id uuid not null references account on delete cascade,
  clan_tag text not null,
  declined_at timestamptz not null default now(),
  primary key (account_id, clan_tag)
);
comment on table account_clan_declined is
  '0205: a clan this account stopped tracking. Elixir never follows it automatically for the account again; tracking it by hand is unaffected.';
