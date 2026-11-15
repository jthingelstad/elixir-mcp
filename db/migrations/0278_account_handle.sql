-- 0278: an account may choose a public @handle.
--
-- Jamie, 2026-11-15: "the accounts should have a username for them".
-- Approved as a unique, optional @handle, public on the account page,
-- in follow lists and in Find, never in MCP (DECISIONS "What is public
-- about an account").
--
-- Stored lowercase, 3 to 20 letters, digits and underscores; unique
-- among the accounts that set one. Null is no handle. Adding a nullable
-- column with no default rewrites no rows.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table account
  add column handle text,
  add column handle_set_at timestamptz,
  add constraint account_handle_shape
    check (handle is null or handle ~ '^[a-z0-9_]{3,20}$');

create unique index account_handle_key on account (handle)
  where handle is not null;
