-- 0233: a Discord account linked to an Elixir account, proven by Discord's
-- own sign-in, and the short-lived state that proof runs on (#531).
--
-- Jamie, 2026-10-24: "Approved: build Discord linking and sign-in for #531
-- in elixir-mcp, with product calls 1-4 as recommended". Email stays the
-- identity (DECISIONS, 2026-10-12): a Discord link is a way in to one
-- email-identified account, never a second identity. One Discord user per
-- account and one account per Discord user, so each id is unique on its
-- own.
--
-- account_discord keeps the Discord user id (a snowflake, as text) and the
-- username Discord gave at the link, for the Console to show. No Discord
-- token is kept: the relay reads the user once and revokes the token.
--
-- discord_login is one Discord round trip: a random state, bound to the
-- browser that started it (nonce_hash, the sha256 of a cookie only that
-- browser holds) and, to link, to the session that asked (session_id), so
-- a callback replayed into another browser or session does nothing. Used
-- once (used_at), expired after ten minutes, and purged by the jobs sweep
-- a day after. A sign-in that opens a new account carries what the email
-- form would have frozen with the request: the browser's zone and the
-- newsletter box (signup_zone, signup_news).
--
-- New tables only; no lock on anything existing.

create table account_discord (
  account_id       uuid primary key references account on delete cascade,
  discord_user_id  text not null unique
                   check (discord_user_id ~ '^[0-9]{17,20}$'),
  username         text not null check (length(username) between 1 and 64),
  linked_at        timestamptz not null default now()
);

comment on table account_discord is
  '0233: the Discord user proven to belong to this account by Discord''s own OAuth (identify scope); a way in, never a second identity (#531).';

create table discord_login (
  state_hash   text primary key,
  nonce_hash   text not null,
  intent       text not null check (intent in ('link', 'signin')),
  account_id   uuid references account on delete cascade,
  session_id   text,
  request_id   uuid,
  signup_zone  text,
  signup_news  boolean not null default false,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  used_at      timestamptz,
  check ((intent = 'link') = (account_id is not null and session_id is not null))
);

create index discord_login_expires on discord_login (expires_at);

comment on table discord_login is
  '0233: one Discord sign-in or link round trip; single use, browser-bound by nonce_hash, session-bound when linking.';
