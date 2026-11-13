-- 0258: the keys the retention trim deletes through.
--
-- Jamie, 2026-11-13: "assume a 1 year data retention", and "Operational
-- logs i would keep for 28 days". The daily trim (packages/record/src/
-- retention.mjs, run by the jobs Lambda) deletes battles older than a
-- year with their player_event rows, and receipts older than 28 days.
--
-- player_event (battle_id): a battle's delete checks player_event for a
-- row still pointing at it, and the trim deletes those rows by battle
-- first. With no index leading on battle_id each check is a scan of
-- player_event, once per battle in a batch.
--
-- The receipt_id foreign keys on clan_event, player_event and
-- clan_snapshot_daily: the column is provenance (which read recorded the
-- row), the receipt is an operational log kept 28 days, and the row it
-- recorded is kept a year. Each receipt deleted would also scan all three
-- tables, none of which indexes receipt_id. The columns stay, with their
-- values; a value older than 28 days names a receipt that is gone.
-- capture_audit's key on receipt_id stays: the trim takes an audit row
-- before its receipt.
--
-- Takes a SHARE lock on player_event while the index builds (writes to
-- it wait; reads do not), and a brief ACCESS EXCLUSIVE on each of the
-- three tables to drop its constraint; lock_timeout fails the deploy
-- rather than queueing behind a long reader.

set local lock_timeout = '5s';

create index player_event_battle on player_event (battle_id)
  where battle_id is not null;

alter table clan_event drop constraint clan_event_receipt_id_fkey;
alter table player_event drop constraint player_event_receipt_id_fkey;
alter table clan_snapshot_daily drop constraint clan_snapshot_daily_receipt_id_fkey;

comment on index player_event_battle is
  'The retention trim deletes a battle''s events by battle_id, and the battle''s own delete checks here (0258).';
comment on column clan_event.receipt_id is
  'The receipt that recorded this event: provenance only, no foreign key since 0258; receipts are kept 28 days.';
comment on column player_event.receipt_id is
  'The receipt that recorded this event: provenance only, no foreign key since 0258; receipts are kept 28 days.';
comment on column clan_snapshot_daily.receipt_id is
  'The receipt that recorded this snapshot: provenance only, no foreign key since 0258; receipts are kept 28 days.';
