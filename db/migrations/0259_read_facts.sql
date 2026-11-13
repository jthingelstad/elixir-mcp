-- 0259: the read facts a year-long reader needs, kept apart from receipts.
--
-- Jamie, 2026-11-13: "assume a 1 year data retention", and "Operational
-- logs i would keep for 28 days". api_receipt (214 MB, the second-largest
-- table on a 1 GB instance) is declared a 28-day log, but its trim is
-- held (0258, packages/record/src/retention.mjs) because four readers
-- still look back up to a year, and none of them needs a receipt's body
-- or bookkeeping, only that a read happened:
--
--  - role history and each member's place at a war finish read the
--    clan's admitted roster reads either side of an instant, and where
--    the clan's live (not imported) roster reads begin;
--  - war award absence evidence reads the roster reads before a week's
--    start and after its finish;
--  - game_events reads which game days an events read covered;
--  - a quiet member's days_since_poll reads the last battle-log read at
--    or before a window's end.
--
-- admitted_read_day keeps every admitted read of a roster ('clan') or of
-- the events list ('events') as its instant, one row per subject and UTC
-- day: about 300 clans and one events list, so a few hundred rows a day
-- whatever the poll rate. battlelog_read_gap keeps only the stretches of
-- a day or more in which a player's battle log went unread, plus one row
-- for the time before its first read: between them every instant is
-- under a day from a read, which is all days_since_poll counts.
--
-- Ingest writes both from 0259's deploy on (packages/record/src/
-- read-facts.mjs); {read_facts_backfill} fills them from the receipts
-- before the receipt trim is switched on. Both are trimmed at a year.
--
-- New tables only: nothing existing is locked or rewritten.

create table admitted_read_day (
  endpoint text not null,
  entity_key text not null,
  day date not null,
  read_at timestamptz[] not null,
  first_live_at timestamptz,
  primary key (endpoint, entity_key, day)
);

comment on table admitted_read_day is
  '0259: every admitted read of a clan roster (endpoint clan) or the events list (endpoint events), one row per subject and UTC day of fetched_at. Written at ingest; kept a year while receipts go at 28 days.';
comment on column admitted_read_day.read_at is
  '0259: the fetched_at of each admitted read that day, distinct, in no promised order.';
comment on column admitted_read_day.first_live_at is
  '0259: the earliest of those reads made by a collector other than the elixir-bot import (gateway backfill-elixir-bot); null when every read that day was imported. A clan''s role history starts at its least value.';

create table battlelog_read_gap (
  player_tag text not null,
  read_at timestamptz,
  next_read_at timestamptz not null,
  primary key (player_tag, next_read_at)
);

comment on table battlelog_read_gap is
  '0259: the stretches in which a player''s battle log went a day or more without an admitted read. Any instant between the first and the latest read that no row covers is under a day from a read. Written at ingest; kept a year.';
comment on column battlelog_read_gap.read_at is
  '0259: the read that opened the stretch; null on the one row per player that stands for the time before its first read.';
comment on column battlelog_read_gap.next_read_at is
  '0259: the read that closed the stretch (for the null row, the first read).';
