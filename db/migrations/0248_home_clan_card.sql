-- 0248: Home's clan card, stored per account (2026-11-12, #649).
--
-- GET /api/me/home/clan built the card on every read: two war reads,
-- then Clan's own "You here" (eight weeks of clans_participation, the
-- roster, every member's activity evidence and the policy's judgment).
-- Over three days: p50 4,161 ms, p95 9,816 ms (n 41), two query_timeout
-- 503s. The card also sits behind the bell on every signed-in page.
--
-- home_clan_card: the record half of that card, kept like Home's week
-- (home_feed, 0245) and the bell's (bell_week, 0247). What decides who
-- may see it and anything about Clan Actions is never stored: Clan's
-- gate is asked on every read, and its answer (the reader's player and
-- role, whether verified, the policy's version, the clan's holds) is
-- digested into `basis`. A read whose basis differs, a clan that is no
-- longer the account's, or a row older than three hours builds now. A
-- departure is refused by the gate before the row is looked at. A cache:
-- the record stays the truth. One row per account.
--
-- A new, empty table. Its foreign key takes a SHARE ROW EXCLUSIVE lock on
-- account for an instant (nothing to validate): fail fast rather than
-- queue sign-ins behind a long read, and let the deploy be retried. The
-- foreign key does not cascade: {account_remove} deletes the row with the
-- account's others.

set local lock_timeout = '5s';

create table home_clan_card (
  account_id  uuid primary key references account,
  clan_tag    text not null,
  basis       text not null,
  built_at    timestamptz not null default now(),
  build_ms    integer not null,
  card        jsonb not null
);

comment on table home_clan_card is
  '0248: the account''s last built Home clan card, its record half (2026-11-12, #649). A cache; Clan Actions, role and the gate are read live on every request.';
comment on column home_clan_card.clan_tag is
  'The clan the card was built for. A read for another clan rebuilds.';
comment on column home_clan_card.basis is
  'A digest of Clan''s gate when built: the reader''s player, role and verification, the policy version and the clan''s holds. A read whose basis differs rebuilds.';
comment on column home_clan_card.build_ms is
  'How long the build took, for the latency notes.';
comment on column home_clan_card.card is
  'The card as GET /api/me/home/clan shaped it, without the fields read live (needs, needs_total, unlock, role, verified).';
