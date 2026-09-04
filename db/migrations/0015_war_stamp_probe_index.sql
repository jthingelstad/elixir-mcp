-- 0015: R1 follow-on. The war-key stamping probe (unstamped riverRace
-- battles for a clan) had no index on any predicate — a 74k-row join
-- scan per currentriverrace poll after the archive import, censused at
-- 3.4s. Partial index keeps exactly the probe's candidate set; it
-- shrinks as battles get stamped.
create index battle_unstamped_war
  on battle (battle_time)
  where season_id is null and type like 'riverRace%';
