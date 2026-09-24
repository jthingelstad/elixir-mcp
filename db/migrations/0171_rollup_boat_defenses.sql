-- 0171: boat defenses counted apart in the daily battle rollups.
--
-- A boat defense is an enemy attacking the clan's boat, answered by the
-- member's defense deck: the member did not play it (Gym #263). War days
-- stopped counting defenses in 7.1.7; clans_standings reads these rollups
-- and could not, so a member attacked often showed a war win rate made of
-- games they never played (NOBITA 0.25 on 09-11). Jamie 2026-09-24:
-- exclude them. The rollup keeps every battle as before and carries how
-- many of its battles, wins and losses were defenses, so a reader can
-- subtract them. Metadata-only (constant defaults); history is filled by
-- the migrate op {rollup_boat_defenses}, not here.

alter table player_daily_battle_rollup
  add column boat_defenses       integer not null default 0,
  add column boat_defense_wins   integer not null default 0,
  add column boat_defense_losses integer not null default 0;
