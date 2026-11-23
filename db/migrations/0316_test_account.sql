-- 0316: account.test_name, a headless test identity that is a person
-- (2026-11-23).
--
-- Jamie, 2026-11-23: "Approved: remove the Agents concept from Elixir" and
-- "Approved: the acceptance and Gym test account may hold a person-bound
-- key". The acceptance suite and the Gym ran as agent accounts with their
-- own door; with agents going, each runs as a person-kind account at /mcp
-- holding a service token minted by the {test_account} op, never from the
-- product (people still cannot mint keys).
--
-- test_name names such an account (acceptance, gym) and is null for every
-- person. It is the marker people-facing counts leave out ({funnel}), and
-- its shape pins what makes the account inert to people: no address (so no
-- mail, no newsletter), and an email_hash of 'test:<name>' that no address
-- hashes to (so nobody signs in as it). It holds no claim and no handle by
-- the op's construction, so no list, search or page reaches it.
-- docs/notes/2026-11-23-test-identities-are-people.md.
--
-- account is small (hundreds of rows): the column is catalog-only, the
-- check scans it once, the unique index builds in a moment.

set local lock_timeout = '5s';

alter table account add column test_name text;

alter table account add constraint account_test_name_shape check (
  test_name is null
  or (test_name ~ '^[a-z0-9][a-z0-9-]{1,40}$'
      and kind = 'person'
      and email is null
      and email_hash = 'test:' || test_name)
);

create unique index account_test_name on account (test_name)
  where test_name is not null;

comment on column account.test_name is
  'A headless test identity (acceptance, gym), a person with no address made by the {test_account} op; null for every person (0316).';
