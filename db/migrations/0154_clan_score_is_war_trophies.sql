-- 0154: say at the source what war_week_clan.clan_score actually holds.
--
-- The column mirrors the race payload's `clanScore` key faithfully, and
-- on a race payload that key carries WAR TROPHIES - not the five- or
-- six-figure clan score a profile shows. A clan object carries both
-- (clanScore 129512, clanWarTrophies 1200 for #J2RGCRVG on 2026-09-23);
-- the race reports the smaller under the larger's name. Our own series
-- proves it without the API: our_clan_score ran 980, 1000, 1020, 1040,
-- 1060, 1160 across 135/0-136/0, rising by exactly each week's
-- trophy_change.
--
-- The column keeps the payload's spelling on purpose - renaming it would
-- hide which key it came from - so the comment carries the truth, the
-- way the war board's entry already does in the payload manifest.
comment on column war_week_clan.clan_score is
  'WAR trophies for this clan, latest observed in a race payload. The API spells it clanScore there, overloading the key: a clan profile''s clanScore is a different, ~100x larger number. Served as clan_war_trophies since 6.19.0; the clan_score name is deprecated on the wire and goes at 7.0.0.';
