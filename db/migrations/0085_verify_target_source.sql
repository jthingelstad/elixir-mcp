-- 0085: the Verify target is drawn from the player's own deck (2026-09-13).
--
-- A random eight was playable in theory and miserable in practice. The
-- target is now the player's most-played deck from their last ten
-- recorded battles with two owned cards of similar elixir cost swapped
-- in; the wizard marks the two swaps so the player sees "your deck, two
-- changes" rather than eight strangers. Both facts ride the challenge so
-- the poll can show them after the start.
alter table claim_challenge add column target_source text
  check (target_source in ('most_played', 'random'));
alter table claim_challenge add column swapped_card_ids integer[];
comment on column claim_challenge.target_source is
  'most_played: the player''s own recent deck with two swaps; random: eight owned cards, used only when no battles are recorded.';
comment on column claim_challenge.swapped_card_ids is
  'The cards swapped INTO the target (the two the player must change); empty for a random draw.';
