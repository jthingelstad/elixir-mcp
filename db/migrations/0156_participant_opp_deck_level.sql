-- 0156: the opponents' deck level, stamped on the participant row.
--
-- Every battle tool that reports a level gap computed the other side's
-- deck level per row, at read time, with a lateral probe back into
-- battle_participant:
--   left join lateral (select avg(o.deck_avg_level) ... where
--     o.battle_id = bp.battle_id and o.side <> bp.side) lv on true
-- There were twelve of these across nine files, plus the nightly meta
-- rollup. {profile_tool} on 2026-09-23 put the cost in one place:
-- battles_meta_cards {segment: "mine"} over the season took 11.8 s, and
-- 5.4 s of that was this probe. It made 6,780 index scans of the
-- primary key and read 8,252 blocks from a cold cache. That is the clan
-- meta read that timed out for the Discord agents.
--
-- The same move 0025 made for the participant's own level: stamp it once,
-- at the seam. Ingest writes it from the same payload that carries both
-- sides. {opp_level_backfill} fills the existing rows in keyset batches
-- (never here: the 0099 rule, a migration never rewrites a large table)
-- and ends with a vacuum, since a bulk UPDATE clears the visibility map.
-- Readers move to the column only after the backfill reports done.
--
-- The value is the lateral's: the mean of the other side's deck_avg_level
-- (two opponents in 2v2), ignoring nulls, and null when there is none.
-- Adding a nullable column is catalog-only, but it takes an exclusive lock
-- for an instant; behind a long read it would queue ingest. Fail fast
-- instead, and let the deploy be retried.
set local lock_timeout = '5s';
alter table battle_participant add column opp_deck_avg_level numeric;
comment on column battle_participant.opp_deck_avg_level is
  'Mean deck_avg_level of the other side''s participants (0156), nulls ignored; null when the other side has none. The level gap is deck_avg_level - opp_deck_avg_level.';
