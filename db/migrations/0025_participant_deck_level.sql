-- Audit census finding (2026-09-05): battles_levels averaged 5.4s/call
-- because every request recomputed deck-average levels from jsonb across
-- the corpus. Stamp the side-average display level once, at the seam.
alter table battle_participant add column deck_avg_level numeric(4,2);

update battle_participant set deck_avg_level = (
  select round(avg((c.value->>'level')::numeric), 2)
  from jsonb_array_elements(deck->'cards') c)
where deck ? 'cards';
