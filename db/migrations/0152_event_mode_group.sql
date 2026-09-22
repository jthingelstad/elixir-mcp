-- 0152: `event` joins the mode groups.
--
-- The API stamps an eventTag on a battle played inside a time-bound
-- event, and on nothing else: `type: trail` carries one on 100% of
-- 123,562 recorded battles while pathOfLegend, PvP, riverRace*,
-- boatBattle and friendly carry one on 0%. The tag - not the type and
-- not the game mode's name - is what separates an event from a format
-- that is always there.
--
-- Until now `trail` folded into `casual`, which filed the Seasonal
-- Trophy Road as casual play (its decks carry Seasonal Arena II's Level
-- 15 floor: mean 15.87 against 13.67 on Trophy Road) and pooled a
-- fortnight's 2v2 tournament with ordinary friendlies. A player's own
-- record still counts those battles - they played them - under `event`.
--
-- The meta tables need no new value: event content is EXCLUDED from the
-- meta population outright rather than bucketed, because a drafted,
-- restricted or level-boosted deck describes the event.

alter table player_daily_battle_rollup drop constraint rollup_mode_group_check;
alter table player_daily_battle_rollup add constraint rollup_mode_group_check check (mode_group in (
  'ladder', 'ranked', 'war', 'casual', 'challenge', 'tournament', 'event', 'other'
)) not valid;
alter table player_daily_battle_rollup validate constraint rollup_mode_group_check;
