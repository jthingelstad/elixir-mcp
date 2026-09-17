-- 0106: the war stamps leave the battle row (schema review 1.2, plan
-- step 6; the contract half of 0105). Instant: column drops take the
-- lock for milliseconds and rewrite nothing; the partial index that
-- served the stamper's probe (0015) goes with them.
--
-- Deployed one deploy after 0105, once no reader named these columns:
-- every war reader resolves a battle by battle_time against war_period
-- and the participant's clan_tag, and nothing has written a stamp since
-- stampWarKeys retired. What the columns held is reproduced exactly by
-- the range for every battle whose stamp agreed with its own time, and
-- corrected for the 3,230 imported rows whose stamp did not.
drop index battle_unstamped_war;
alter table battle
  drop column season_id,
  drop column section_index,
  drop column war_day;
