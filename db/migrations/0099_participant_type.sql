-- The participant carries battle.type too; no read path joins battle
-- for a filter any more (battle_time 0001, clan_tag 0089, type_class
-- 0095, now type: a filter reads the participant, battle is for battle
-- facts). The excluded breakdown's duel exclusion was the last join, and
-- 4.1 of the ~5 s left in a clan-scoped meta call (explain_meta).
--
-- This migration is the instant part only: adding a nullable column
-- with no default touches no row. The first version of 0099 did the
-- 468k-row backfill and two index rebuilds in this transaction; it
-- outlived the migrate Lambda's 300 s on 2026-09-15 and its orphaned
-- backend held the ACCESS EXCLUSIVE lock from this ALTER until every
-- connection was queued behind it (docs/NOTES.md). The backfill is the
-- batched op {type_backfill}; the index changes are 0100, after it.
-- Nullable on purpose: ingest always writes it; a row without it
-- matches no type filter rather than lying with a default.

alter table battle_participant add column type text;
