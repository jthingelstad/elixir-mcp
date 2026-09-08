-- A profile delta spans observation instants, not a calendar day. Retire
-- derived estimates that compared a multi-day delta with one day's capture.
-- Canonical battles and snapshots are unchanged. Coverage now recomputes
-- matching intervals from those records, including late-arriving battles.
-- Keep the nullable columns for expand-and-contract compatibility.
update player_daily_battle_rollup
set expected_battle_delta = null, completeness_ratio = null, is_complete = null
where expected_battle_delta is not null or completeness_ratio is not null
   or is_complete is not null;
